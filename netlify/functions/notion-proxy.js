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
                
                // Week Reference IDs mapping
                const WEEK_REFERENCE_IDS = {
                    1: '2421495c-e9ab-80d9-a954-e11c828688a9',
                    2: '2421495c-e9ab-80b5-88ed-d428e228d346',
                    3: '2421495c-e9ab-8113-9acc-c6986f533743',
                    4: '2421495c-e9ab-812d-9fdc-c85af2665b7c',
                    5: '2421495c-e9ab-8130-9ac5-f6a074f3a17a',
                    6: '2421495c-e9ab-813c-9cf3-eba5b4f5576c',
                    7: 'YOUR_WEEK_7_REFERENCE_ID',
                    8: 'YOUR_WEEK_8_REFERENCE_ID',
                    9: '2421495c-e9ab-81bb-811e-f9aa61eb3a39',
                    10: '2421495c-e9ab-81d8-9680-df3499e4a322',
                    11: '2421495c-e9ab-81da-b521-dc78ce8d0a74',
                    12: '2421495c-e9ab-81e3-8f42-c977be4ab77b'
                };
                
                // Query milestones with all properties - NO SORTING since Week property is deleted
                const milestonesResponse = await notion.databases.query({
                    database_id: milestonesDbId,
                    page_size: 100
                    // Removed sorts since Week property no longer exists
                });

                console.log(`Found ${milestonesResponse.results.length} milestones`);

                // Calculate current week based on 12-week start date
                const TWELVE_WEEK_START = new Date('2025-08-04'); // Week 1 starts Aug 4, 2025
                const currentDate = new Date();
                const daysSinceStart = Math.floor((currentDate - TWELVE_WEEK_START) / (1000 * 60 * 60 * 24));
                const currentWeekNumber = Math.min(Math.max(Math.floor(daysSinceStart / 7) + 1, 1), 12);
                
                // Process milestones using Week Reference instead of Week property
                const processedMilestones = milestonesResponse.results.map(page => {
                    const props = page.properties;
                    
                    // Get Week Reference relation
                    const weekReferenceRelation = props['Week Reference']?.relation || [];
                    const weekReferenceIds = weekReferenceRelation.map(ref => ref.id);
                    
                    // Determine week number from Week Reference
                    let weekNumberFromReference = null;
                    if (weekReferenceIds.length > 0) {
                        const firstReferenceId = weekReferenceIds[0];
                        // Find which week this reference ID corresponds to
                        for (const [weekNum, refId] of Object.entries(WEEK_REFERENCE_IDS)) {
                            if (refId === firstReferenceId) {
                                weekNumberFromReference = parseInt(weekNum);
                                break;
                            }
                        }
                    }
                    
                    // Check if milestone is in current week based on Week Reference
                    const isCurrentWeek = weekNumberFromReference === currentWeekNumber;
                    
                    // Also check formula/rollup fields if they exist
                    const isCurrentFormula = props['Is Current Week']?.formula?.boolean || false;
                    const isCurrentAuto = props['Is Current (Auto)']?.rollup?.array?.[0]?.checkbox || false;
                    
                    return {
                        id: page.id,
                        properties: props,
                        // Add computed fields for easier access
                        computed: {
                            weekNumber: weekNumberFromReference,
                            isCurrentWeek: isCurrentWeek || isCurrentFormula || isCurrentAuto,
                            completionStatus: props.Completed?.checkbox ? '✅ Completed' : '⏳ In Progress',
                            dueDate: props['Due Date']?.date?.start || null,
                            weekStartDate: props['Week Start Date']?.date?.start || null,
                            weekReferenceIds: weekReferenceIds
                        }
                    };
                });

                // Get unique focus areas for summary
                const focusAreas = [...new Set(processedMilestones
                    .map(m => m.properties['Focus Area']?.select?.name)
                    .filter(Boolean))];
                
                // Get unique weeks based on Week Reference
                const weekNumbers = [...new Set(processedMilestones
                    .map(m => m.computed.weekNumber)
                    .filter(num => num !== null))];

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
                            weekNumbers,
                            currentWeek: currentWeekNumber,
                            currentWeekMilestones: processedMilestones.filter(m => 
                                m.computed.isCurrentWeek
                            ).length,
                            weekBreakdown: weekNumbers.map(weekNum => {
                                if (weekNum === null) return null;
                                const weekMilestones = processedMilestones.filter(m => 
                                    m.computed.weekNumber === weekNum
                                );
                                return {
                                    weekNumber: weekNum,
                                    isCurrent: weekNum === currentWeekNumber,
                                    total: weekMilestones.length,
                                    completed: weekMilestones.filter(m => m.properties.Completed?.checkbox).length
                                };
                            }).filter(Boolean)
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

        // Handle fitness database query
        if (body.fitnessDbId) {
            try {
                console.log('Querying fitness database:', body.fitnessDbId);
                
                const fitnessResponse = await notion.databases.query({
                    database_id: body.fitnessDbId,
                    filter: {
                        property: 'Dashboard Type',
                        select: {
                            equals: 'Main'
                        }
                    },
                    page_size: 1
                });

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        results: fitnessResponse.results,
                        hasMore: fitnessResponse.has_more
                    })
                };

            } catch (error) {
                console.error('Fitness API Error:', error);
                
                return {
                    statusCode: 500,
                    headers,
                    body: JSON.stringify({ 
                        error: 'Failed to query fitness database',
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
