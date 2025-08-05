// netlify/functions/task-automation.js
const { Client } = require('@notionhq/client');

// Database IDs
const TASKS_DB_ID = 'e1cdae69-6ef0-442f-9777-01c2d7473b66';
const MILESTONES_DB_ID = 'dab40b08-41d9-4457-bb96-471835d466b7';

exports.handler = async (event, context) => {
    // Enable CORS
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    // Handle preflight requests
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: ''
        };
    }

    try {
        const { token } = JSON.parse(event.body);

        if (!token) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Notion token is required' })
            };
        }

        const notion = new Client({ auth: token });

        // Step 1: Query Task Bank for all "📅 Planned" tasks
        console.log('Querying Task Bank for planned tasks...');
        
        // First, let's try to get the database schema to understand the properties
        let statusPropertyName = 'Status';
        let taskPropertyName = 'Task';
        let focusAreaPropertyName = 'Focus Area';
        let weekReferencePropertyName = 'Week Reference';
        let priorityPropertyName = 'Priority';
        let notesPropertyName = 'Notes';
        let milestonePropertyName = 'Milestone';
        
        try {
            const dbInfo = await notion.databases.retrieve({
                database_id: TASKS_DB_ID
            });
            
            // Log the properties to help debug
            console.log('Task Bank properties:', Object.keys(dbInfo.properties));
            
            // Find the actual property names (they might be different)
            for (const [key, prop] of Object.entries(dbInfo.properties)) {
                if (prop.type === 'select' && key.toLowerCase().includes('status')) {
                    statusPropertyName = key;
                }
                if (prop.type === 'title') {
                    taskPropertyName = key;
                }
            }
        } catch (error) {
            console.log('Could not retrieve database schema, using default property names');
        }
        
        const tasksResponse = await notion.databases.query({
            database_id: TASKS_DB_ID,
            filter: {
                property: statusPropertyName,
                select: {
                    equals: '📅 Planned'
                }
            },
            page_size: 100
        });

        const plannedTasks = tasksResponse.results;
        console.log(`Found ${plannedTasks.length} planned tasks`);

        if (plannedTasks.length === 0) {
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    success: true,
                    message: 'No planned tasks found to process',
                    summary: {
                        tasksProcessed: 0,
                        milestonesCreated: 0,
                        tasksLinked: 0
                    }
                })
            };
        }

        // Step 2: Process each planned task
        let milestonesCreated = 0;
        let tasksLinked = 0;
        const errors = [];

        for (const task of plannedTasks) {
            try {
                const taskProps = task.properties;
                const taskName = taskProps[taskPropertyName]?.title?.[0]?.text?.content || 
                               taskProps.Task?.title?.[0]?.text?.content || 
                               taskProps.Name?.title?.[0]?.text?.content || 
                               'Untitled Task';
                
                const focusArea = taskProps[focusAreaPropertyName]?.select?.name || 
                                taskProps['Focus Area']?.select?.name;
                
                const weekReference = taskProps[weekReferencePropertyName]?.relation?.[0]?.id || 
                                    taskProps['Week Reference']?.relation?.[0]?.id;
                
                const priority = taskProps[priorityPropertyName]?.select?.name || 
                               taskProps.Priority?.select?.name || 'P3';
                
                const notes = taskProps[notesPropertyName]?.rich_text?.[0]?.text?.content || 
                            taskProps.Notes?.rich_text?.[0]?.text?.content || '';
                
                console.log(`Processing task: ${taskName}`);
                console.log(`Properties found: Focus Area=${focusArea}, Week Ref=${weekReference}, Priority=${priority}`);

                // Skip if no week reference
                if (!weekReference) {
                    console.log(`Skipping task "${taskName}" - no week reference`);
                    errors.push({
                        task: taskName,
                        error: 'No week reference found'
                    });
                    continue;
                }

                // Get week details from Week Reference
                let weekNumber = null;
                let weekStart = null;
                let weekEnd = null;
                
                try {
                    const weekPage = await notion.pages.retrieve({ page_id: weekReference });
                    const weekTitle = weekPage.properties.Name?.title?.[0]?.text?.content || '';
                    // Extract week number from title (e.g., "Week 1 - Aug 4-10, 2025")
                    const weekMatch = weekTitle.match(/Week (\d+)/);
                    if (weekMatch) {
                        weekNumber = `Week ${weekMatch[1]}`;
                    }
                    
                    // Get dates from week reference
                    weekStart = weekPage.properties['Start Date']?.date?.start;
                    weekEnd = weekPage.properties['End Date']?.date?.start;
                } catch (error) {
                    console.log(`Could not retrieve week details: ${error.message}`);
                }

                // Step 3: Create milestone in Weekly Milestones database
                const milestoneData = {
                    parent: { database_id: MILESTONES_DB_ID },
                    properties: {
                        'Task': {
                            title: [{
                                text: { content: taskName }
                            }]
                        },
                        'Focus Area': focusArea ? {
                            select: { name: focusArea }
                        } : undefined,
                        'Week': weekNumber ? {
                            select: { name: weekNumber }
                        } : undefined,
                        'Week Reference': {
                            relation: [{ id: weekReference }]
                        },
                        'Deadline Type': {
                            select: { 
                                name: priority === 'P1' ? 'Critical (Fixed)' : 
                                      priority === 'P2' ? 'Target' : 'Flexible'
                            }
                        },
                        'Completed': {
                            checkbox: false
                        },
                        'Notes': notes ? {
                            rich_text: [{
                                text: { content: `Auto-created from Task Bank\n\nOriginal Notes: ${notes}` }
                            }]
                        } : {
                            rich_text: [{
                                text: { content: 'Auto-created from Task Bank' }
                            }]
                        }
                    }
                };

                // Add due date if we have week end date
                if (weekEnd) {
                    milestoneData.properties['Due Date'] = {
                        date: { start: weekEnd }
                    };
                }

                // Add week start date if available
                if (weekStart) {
                    milestoneData.properties['Week Start Date'] = {
                        date: { start: weekStart }
                    };
                }

                const milestone = await notion.pages.create(milestoneData);
                milestonesCreated++;
                console.log(`Created milestone: ${taskName}`);

                // Step 4: Update task status to "🔄 In Progress" and link milestone
                const updateData = {
                    page_id: task.id,
                    properties: {}
                };
                
                // Update status
                updateData.properties[statusPropertyName] = {
                    select: { name: '🔄 In Progress' }
                };
                
                // Link milestone if we have a milestone property
                if (milestonePropertyName in taskProps || 'Milestone' in taskProps) {
                    updateData.properties[milestonePropertyName] = {
                        relation: [{ id: milestone.id }]
                    };
                }
                
                await notion.pages.update(updateData);
                tasksLinked++;
                console.log(`Updated task status and linked milestone`);

            } catch (error) {
                console.error(`Error processing task: ${error.message}`);
                errors.push({
                    task: task.properties.Task?.title?.[0]?.text?.content || 'Unknown',
                    error: error.message
                });
            }
        }

        // Return summary
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                message: `Processed ${plannedTasks.length} tasks`,
                summary: {
                    tasksProcessed: plannedTasks.length,
                    milestonesCreated,
                    tasksLinked,
                    errors: errors.length
                },
                errors: errors.length > 0 ? errors : undefined
            })
        };

    } catch (error) {
        console.error('Automation error:', error);
        console.error('Error stack:', error.stack);
        
        // Provide more detailed error information
        let errorMessage = error.message;
        if (error.code === 'object_not_found') {
            errorMessage = 'Database not found. Please check the database IDs.';
        } else if (error.code === 'unauthorized') {
            errorMessage = 'Invalid Notion token or insufficient permissions.';
        } else if (error.code === 'validation_error') {
            errorMessage = 'Invalid data format. Check property names and types.';
        }
        
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Automation failed',
                message: errorMessage,
                details: error.body || error.message,
                code: error.code
            })
        };
    }
};
