// netlify/functions/notion-proxy.js - UPDATED VERSION FOR BOTH DATABASES
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
        console.log('Proxy function called:', event.httpMethod);
        console.log('Request body:', event.body);

        const { token, database_id, action, page_size = 100, filter, sorts } = JSON.parse(event.body || '{}');

        if (!token) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Notion token is required' })
            };
        }

        if (!database_id) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Database ID is required' })
            };
        }

        const notion = new Client({ auth: token });

        console.log(`Querying database: ${database_id}`);
        
        // Identify which database we're querying
        const isFitnessDatabase = database_id === '55615d1316a844b08432424441aa6f21';
        const isMilestonesDatabase = database_id === 'dab40b08-41d9-4457-bb96-471835d466b7';

        console.log(`Database type: ${isFitnessDatabase ? 'Fitness Dashboard' : isMilestonesDatabase ? 'Milestones' : 'Unknown'}`);

        // Build query options
        const queryOptions = {
            database_id: database_id,
            page_size: Math.min(page_size, 100)
        };

        // Add filter if provided
        if (filter) {
            queryOptions.filter = filter;
            console.log('Applied filter:', JSON.stringify(filter, null, 2));
        }

        // Add sorts if provided - REMOVE the problematic "Week" sort
        if (sorts && Array.isArray(sorts)) {
            // Filter out any sorts that reference the deleted "Week" property
            const validSorts = sorts.filter(sort => sort.property !== 'Week');
            if (validSorts.length > 0) {
                queryOptions.sorts = validSorts;
                console.log('Applied sorts:', JSON.stringify(validSorts, null, 2));
            }
        }

        console.log('Final query options:', JSON.stringify(queryOptions, null, 2));

        const response = await notion.databases.query(queryOptions);

        console.log(`Successfully fetched ${response.results.length} results from ${isFitnessDatabase ? 'Fitness Dashboard' : isMilestonesDatabase ? 'Milestones' : 'Unknown'} database`);

        // Process results differently based on database type
        let processedResults = response.results;

        if (isMilestonesDatabase) {
            // Process milestones with week information
            processedResults = response.results.map(page => {
                const processed = { ...page };
                
                // Add week number based on Week Reference relation
                const weekReference = page.properties['Week Reference']?.relation;
                if (weekReference && weekReference.length > 0) {
                    // Map Week Reference IDs to week numbers
                    const weekRefId = weekReference[0].id;
                    const weekMapping = {
                        '2421495c-e9ab-80d9-a954-e11c828688a9': 1, // Week 1
                        '2421495c-e9ab-80b5-88ed-d428e228d346': 2, // Week 2
                        '2421495c-e9ab-8113-9acc-c6986f533743': 3, // Week 3
                        '2421495c-e9ab-812d-9fdc-c85af2665b7c': 4, // Week 4
                        '2421495c-e9ab-8130-9ac5-f6a074f3a17a': 5, // Week 5
                        '2421495c-e9ab-813c-9cf3-eba5b4f5576c': 6, // Week 6
                        '2421495c-e9ab-81bb-811e-f9aa61eb3a39': 9, // Week 9
                        '2421495c-e9ab-81d8-9680-df3499e4a322': 10, // Week 10
                        '2421495c-e9ab-81da-b521-dc78ce8d0a74': 11, // Week 11
                        '2421495c-e9ab-81e3-8f42-c977be4ab77b': 12  // Week 12
                    };
                    
                    processed.weekNumber = weekMapping[weekRefId] || null;
                    console.log(`Mapped week reference ${weekRefId} to week ${processed.weekNumber}`);
                }
                
                return processed;
            });
        } else if (isFitnessDatabase) {
            // Process fitness dashboard entries
            console.log('Processing fitness dashboard results...');
            processedResults = response.results.map(page => {
                const processed = { ...page };
                
                // Log fitness entry details for debugging
                const props = page.properties;
                console.log(`Fitness entry: "${props.title?.title?.[0]?.text?.content || 'Untitled'}" - Weight: ${props['Current Weight']?.number}kg, Dashboard Type: "${props['Dashboard Type']?.select?.name}"`);
                
                return processed;
            });
        }

        // Log final results for debugging
        if (isFitnessDatabase && filter?.property === 'Dashboard Type') {
            console.log(`FITNESS DEBUG: Found ${processedResults.length} entries with Dashboard Type = "${filter.select.equals}"`);
            processedResults.forEach((result, index) => {
                const weight = result.properties['Current Weight']?.number;
                const dashboardType = result.properties['Dashboard Type']?.select?.name;
                console.log(`Entry ${index}: Weight=${weight}kg, Dashboard Type="${dashboardType}"`);
            });
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                ...response,
                results: processedResults
            })
        };

    } catch (error) {
        console.error('Proxy error:', error);
        console.error('Error stack:', error.stack);
        
        // More detailed error for debugging
        let errorMessage = error.message;
        if (error.code === 'object_not_found') {
            errorMessage = 'Database not found. Check database ID.';
        } else if (error.code === 'unauthorized') {
            errorMessage = 'Invalid Notion token or insufficient permissions.';
        } else if (error.code === 'validation_error') {
            errorMessage = 'Invalid query format or property names.';
        }
        
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: 'Proxy failed',
                message: errorMessage,
                details: error.body || error.message,
                code: error.code,
                database_id: JSON.parse(event.body || '{}').database_id
            })
        };
    }
};
