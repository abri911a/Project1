// netlify/functions/notion-proxy.js
const { Client } = require('@notionhq/client');

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
        const body = JSON.parse(event.body);
        const { token, milestonesDbId, endpoint, action } = body;

        if (!token) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Notion token is required' })
            };
        }

        const notion = new Client({ auth: token });

        // Handle milestones database query
        if (milestonesDbId && (!endpoint || endpoint === 'databases') && (!action || action === 'query')) {
            try {
                console.log('Querying milestones database:', milestonesDbId);
                
                // Query milestones with all properties
                const milestonesResponse = await notion.databases.query({
                    database_id: milestonesDbId,
                    page_size: 100,
                    sorts: [
                        {
                            property: 'Week',
                            direction: 'ascending'
                        }
                    ]
                });

                console.log(`Found ${milestonesResponse.results.length} milestones`);

                // Calculate current week based on 12-week start date
                const TWELVE_WEEK_START = new Date('2025-08-04'); // Week 1 starts Aug 4, 2025
                const currentDate = new Date();
                const daysSinceStart = Math.floor((currentDate - TWELVE_WEEK_START) / (1000 * 60 * 60 * 24));
                const currentWeekNumber = Math.min(Math.max(Math.floor(daysSinceStart / 7) + 1, 1), 12);
                
                // Process milestones to extract all relevant information
                const processedMilestones = milestonesResponse.results.map(page => {
                    const props = page.properties;
                    
                    // Extract week number from Week select property
                    const weekName = props.Week?.select?.name || '';
                    const weekNumber = parseInt(weekName.replace('Week ', '') || '0');
                    
                    // Check if milestone is in current week
                    const isCurrentWeek = weekNumber === currentWeekNumber;
                    
                    // Also check formula/rollup fields if they exist
                    const isCurrentFormula = props['Is Current Week']?.formula?.boolean || false;
                    const isCurrentAuto = props['Is Current (Auto)']?.rollup?.array?.[0]?.checkbox || false;
                    
                    return {
                        id: page.id,
                        properties: props,
                        // Add computed fields for easier access
                        computed: {
                            weekNumber,
                            isCurrentWeek: isCurrentWeek || isCurrentFormula || isCurrentAuto,
                            completionStatus: props.Completed?.checkbox ? '✅ Completed' : '⏳ In Progress',
                            dueDate: props['Due Date']?.date?.start || null,
                            weekStartDate: props['Week Start Date']?.date?.start || null
                        }
                    };
                });

                // Get unique focus areas and weeks for summary
                const focusAreas = [...new Set(processedMilestones
                    .map(m => m.properties['Focus Area']?.select?.name)
                    .filter(Boolean))];
                
                const weeks = [...new Set(processedMilestones
                    .map(m => m.properties.Week?.select?.name)
                    .filter(Boolean))];

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        results: processedMilestones,
                        hasMore: milestonesResponse.has_more,
                        nextCursor: milestonesResponse.next_cursor,
                        summary: {
                            totalMilestones: processedMilestones.length,
                            completedMilestones: processedMilestones.filter(m => 
                                m.properties.Completed?.checkbox
                            ).length,
                            focusAreas,
                            weeks,
                            currentWeek: currentWeekNumber,
                            currentWeekMilestones: processedMilestones.filter(m => 
                                m.computed.isCurrentWeek
                            ).length,
                            weekBreakdown: weeks.map(week => {
                                const weekNum = parseInt(week.replace('Week ', '') || '0');
                                const weekMilestones = processedMilestones.filter(m => 
                                    m.computed.weekNumber === weekNum
                                );
                                return {
                                    week: week,
                                    weekNumber: weekNum,
                                    isCurrent: weekNum === currentWeekNumber,
                                    total: weekMilestones.length,
                                    completed: weekMilestones.filter(m => m.properties.Completed?.checkbox).length
                                };
                            })
                        }
                    })
                };

            } catch (error) {
                console.error('Notion API Error:', error);
                console.error('Error details:', error.message, error.code);
                
                return {
                    statusCode: 500,
                    headers,
                    body: JSON.stringify({ 
                        error: 'Failed to query milestones database',
                        details: error.message,
                        code: error.code
                    })
                };
            }
        }

        // Handle other database queries (backward compatibility)
        if (endpoint === 'databases' && action === 'query') {
            const { database_id, filter, sorts, page_size = 100 } = body;
            
            const response = await notion.databases.query({
                database_id,
                filter,
                sorts,
                page_size
            });

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify(response)
            };
        }

        // Handle page retrieval
        if (endpoint === 'pages' && action === 'retrieve') {
            const { page_id } = body;
            
            const response = await notion.pages.retrieve({
                page_id
            });

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify(response)
            };
        }

        // Handle database retrieval
        if (endpoint === 'databases' && action === 'retrieve') {
            const { database_id } = body;
            
            const response = await notion.databases.retrieve({
                database_id
            });

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify(response)
            };
        }

        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Invalid endpoint or action' })
        };

    } catch (error) {
        console.error('Proxy error:', error);
        console.error('Error stack:', error.stack);
        
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: 'Internal server error',
                message: error.message,
                code: error.code
            })
        };
    }
};
