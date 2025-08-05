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
        const { token, milestonesDbId, endpoint = 'databases', action = 'query' } = JSON.parse(event.body);

        if (!token) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Notion token is required' })
            };
        }

        const notion = new Client({ auth: token });

        // Handle milestones database query
        if (milestonesDbId && endpoint === 'databases' && action === 'query') {
            try {
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

                // Process milestones to extract all relevant information
                const processedMilestones = milestonesResponse.results.map(page => {
                    const props = page.properties;
                    
                    // Extract week number from Week select property
                    const weekName = props.Week?.select?.name || '';
                    const weekNumber = parseInt(weekName.replace('Week ', '') || '0');
                    
                    // Calculate if it's the current week
                    const currentDate = new Date();
                    const isCurrentWeek = props['Is Current Week']?.formula?.boolean || false;
                    const isCurrentAuto = props['Is Current (Auto)']?.rollup?.array?.[0]?.checkbox || false;
                    
                    return {
                        id: page.id,
                        properties: props,
                        // Add computed fields for easier access
                        computed: {
                            weekNumber,
                            isCurrentWeek: isCurrentWeek || isCurrentAuto,
                            completionStatus: props.Completed?.checkbox ? '✅ Completed' : '⏳ In Progress'
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
                            currentWeekMilestones: processedMilestones.filter(m => 
                                m.computed.isCurrentWeek
                            ).length
                        }
                    })
                };

            } catch (error) {
                console.error('Notion API Error:', error);
                return {
                    statusCode: 500,
                    headers,
                    body: JSON.stringify({ 
                        error: 'Failed to query milestones database',
                        details: error.message 
                    })
                };
            }
        }

        // Handle other database queries (backward compatibility)
        if (endpoint === 'databases' && action === 'query') {
            const { database_id, filter, sorts, page_size = 100 } = JSON.parse(event.body);
            
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
            const { page_id } = JSON.parse(event.body);
            
            const response = await notion.pages.retrieve({
                page_id
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
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: 'Internal server error',
                message: error.message 
            })
        };
    }
};
