// netlify/functions/notion-proxy.js - UPDATED VERSION
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

        // Build query options
        const queryOptions = {
            database_id: database_id,
            page_size: Math.min(page_size, 100)
        };

        // Add filter if provided
        if (filter) {
            queryOptions.filter = filter;
        }

        // Add sorts if provided - REMOVE the problematic "Week" sort
        if (sorts && Array.isArray(sorts)) {
            // Filter out any sorts that reference the deleted "Week" property
            const validSorts = sorts.filter(sort => sort.property !== 'Week');
            if (validSorts.length > 0) {
                queryOptions.sorts = validSorts;
            }
        }

        console.log('Query options:', JSON.stringify(queryOptions, null, 2));

        const response = await notion.databases.query(queryOptions);

        console.log(`Successfully fetched ${response.results.length} results`);

        // Process results to add week information
        const processedResults = response.results.map(page => {
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
            }
            
            return processed;
        });

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
        
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: 'Proxy failed',
                message: error.message,
                details: error.body || error.message
            })
        };
    }
};
