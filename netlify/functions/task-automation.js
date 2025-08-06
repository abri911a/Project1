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

        // Step 1: Query Task Bank for tasks that need milestones
        // Using the same filter as the Python script
        console.log('Querying Task Bank for tasks needing milestones...');
        
        const tasksResponse = await notion.databases.query({
            database_id: TASKS_DB_ID,
            filter: {
                and: [
                    {
                        property: "Week Reference",
                        relation: {
                            is_not_empty: true
                        }
                    },
                    {
                        property: "Linked to Weekly Milestone",
                        relation: {
                            is_empty: true
                        }
                    }
                ]
            },
            page_size: 100
        });

        const candidateTasks = tasksResponse.results;
        console.log(`Found ${candidateTasks.length} tasks needing milestones`);

        if (candidateTasks.length === 0) {
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    success: true,
                    message: 'No tasks found that need milestones',
                    summary: {
                        tasksProcessed: 0,
                        milestonesCreated: 0,
                        tasksLinked: 0
                    }
                })
            };
        }

        // Step 2: Process each task
        let milestonesCreated = 0;
        let tasksLinked = 0;
        let duplicatesSkipped = 0;
        const errors = [];

        for (const task of candidateTasks) {
            try {
                const taskProps = task.properties;
                
                // Get task title
                const taskName = taskProps.Task?.title?.[0]?.text?.content || 'Untitled Task';
                
                console.log(`Processing task: ${taskName}`);
                
                // Check if a milestone already exists for this task
                // Query the milestones database to see if there's already a milestone with this task name
                const existingMilestoneQuery = await notion.databases.query({
                    database_id: MILESTONES_DB_ID,
                    filter: {
                        property: "Task",
                        title: {
                            equals: taskName
                        }
                    },
                    page_size: 10
                });
                
                if (existingMilestoneQuery.results.length > 0) {
                    console.log(`⚠️ Milestone already exists for task: ${taskName}`);
                    duplicatesSkipped++;
                    
                    // Link the task to the existing milestone if not already linked
                    const existingMilestone = existingMilestoneQuery.results[0];
                    await notion.pages.update({
                        page_id: task.id,
                        properties: {
                            'Linked to Weekly Milestone': {
                                relation: [{ id: existingMilestone.id }]
                            }
                        }
                    });
                    console.log('✅ Linked task to existing milestone');
                    continue;
                }
                
                // Get other properties
                const focusArea = taskProps['Focus Area']?.select?.name;
                const priority = taskProps.Priority?.select?.name;
                const notes = taskProps.Notes?.rich_text?.[0]?.text?.content || '';
                const weekReference = taskProps['Week Reference']?.relation || [];
                
                console.log(`Processing task: ${taskName}`);
                console.log(`  Focus Area: ${focusArea}`);
                console.log(`  Priority: ${priority}`);
                console.log(`  Week Reference found: ${weekReference.length > 0}`);

                // Determine deadline type based on priority
                let deadlineType = 'Target'; // Default
                if (priority === '🔥 High') {
                    deadlineType = 'Critical (Fixed)';
                } else if (priority === '⚡ Medium') {
                    deadlineType = 'Target';
                } else if (priority === '💧 Low') {
                    deadlineType = 'Flexible';
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
                        'Notes': {
                            rich_text: [{
                                text: { 
                                    content: `Auto-created from Task Bank\n\nOriginal Notes: ${notes}\nPriority: ${priority || 'Not set'}`
                                }
                            }]
                        },
                        'Deadline Type': {
                            select: { name: deadlineType }
                        },
                        'Completed': {
                            checkbox: false
                        }
                    }
                };

                // Add focus area if available
                if (focusArea) {
                    milestoneData.properties['Focus Area'] = {
                        select: { name: focusArea }
                    };
                }

                // Add Week Reference if we have it
                if (weekReference.length > 0) {
                    milestoneData.properties['Week Reference'] = {
                        relation: weekReference
                    };
                    console.log('  Added Week Reference to milestone');
                    
                    // Try to determine the Week number from the Week Reference
                    try {
                        const weekRefId = weekReference[0].id;
                        const weekPage = await notion.pages.retrieve({ page_id: weekRefId });
                        const weekTitle = weekPage.properties.Name?.title?.[0]?.text?.content || '';
                        const weekMatch = weekTitle.match(/Week (\d+)/);
                        if (weekMatch) {
                            milestoneData.properties['Week'] = {
                                select: { name: `Week ${weekMatch[1]}` }
                            };
                            console.log(`  Set Week to: Week ${weekMatch[1]}`);
                        }
                    } catch (weekError) {
                        console.log('  Could not determine week number from reference');
                    }
                } else {
                    console.log('  No Week Reference data available');
                }

                const milestone = await notion.pages.create(milestoneData);
                milestonesCreated++;
                console.log(`✅ Created milestone: ${milestone.id}`);

                // Step 4: Link the task back to the milestone
                await notion.pages.update({
                    page_id: task.id,
                    properties: {
                        'Linked to Weekly Milestone': {
                            relation: [{ id: milestone.id }]
                        }
                    }
                });
                tasksLinked++;
                console.log('✅ Linked task back to milestone');

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
                message: `Processed ${candidateTasks.length} tasks`,
                summary: {
                    tasksProcessed: candidateTasks.length,
                    milestonesCreated,
                    tasksLinked,
                    duplicatesSkipped,
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
