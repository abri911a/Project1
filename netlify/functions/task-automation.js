// netlify/functions/task-automation.js - ENHANCED VERSION
// Now includes Week Reference → Scorecard Week sync
const { Client } = require('@notionhq/client');

// Database IDs
const TASKS_DB_ID = 'e1cdae69-6ef0-442f-9777-01c2d7473b66';
const MILESTONES_DB_ID = 'dab40b08-41d9-4457-bb96-471835d466b7';

// Week Reference ID → Scorecard Week ID mapping
const WEEK_REFERENCE_TO_SCORECARD_MAPPING = {
    "2421495c-e9ab-80d9-a954-e11c828688a9": "2421495c-e9ab-8105-8a5d-fdc58ca483fb", // Week 1 ✅ VERIFIED
    "2421495c-e9ab-80b5-88ed-d428e228d346": "2421495c-e9ab-81be-9b76-c6a1105f7f29", // Week 2
    "2421495c-e9ab-8113-9acc-c6986f533743": "2421495c-e9ab-81b6-8ec5-fb68d89ad153", // Week 3
    "2421495c-e9ab-812d-9fdc-c85af2665b7c": "2421495c-e9ab-8194-9bbc-c60146c2b950", // Week 4
    "2421495c-e9ab-8130-9ac5-f6a074f3a17a": "2421495c-e9ab-815d-93ff-dd6e162a08d1", // Week 5
    "2421495c-e9ab-813c-9cf3-eba5b4f5576c": "2431495c-e9ab-81a6-a82f-f3bee4b399a2", // Week 6
    // Week 7-8 Reference IDs needed
    "WEEK_7_REF_ID": "2431495c-e9ab-810b-aabf-c44bab7da095", // Week 7
    "WEEK_8_REF_ID": "2431495c-e9ab-813d-8d6d-d478ae4bf47a", // Week 8 ✅
    "2421495c-e9ab-81bb-811e-f9aa61eb3a39": "2431495c-e9ab-8109-bf90-ffbb310a121b", // Week 9 ✅
    "2421495c-e9ab-81d8-9680-df3499e4a322": "2431495c-e9ab-8162-941a-c126e59c8af5", // Week 10
    "2421495c-e9ab-81da-b521-dc78ce8d0a74": "2431495c-e9ab-8141-8a96-f2f4ad38f44f", // Week 11
    "2421495c-e9ab-81e3-8f42-c977be4ab77b": "2431495c-e9ab-8171-b2a9-f372a218a07c"  // Week 12
};

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
        const { token, action } = JSON.parse(event.body || '{}');

        if (!token) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Notion token is required' })
            };
        }

        const notion = new Client({ auth: token });

        // Determine which action to perform
        switch (action) {
            case 'sync_week_references':
                return await syncWeekReferences(notion, headers);
            case 'convert_tasks':
            default:
                return await convertTasksToMilestones(notion, headers);
        }

    } catch (error) {
        console.error('Automation error:', error);
        
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: 'Automation failed',
                message: error.message
            })
        };
    }
};

// ORIGINAL FUNCTION: Convert tasks to milestones
async function convertTasksToMilestones(notion, headers) {
    console.log('Starting task conversion...');
    
    // Your existing task conversion logic here...
    const tasksResponse = await notion.databases.query({
        database_id: TASKS_DB_ID,
        filter: {
            and: [
                {
                    property: "Week Reference",
                    relation: { is_not_empty: true }
                },
                {
                    property: "Linked to Weekly Milestone",
                    relation: { is_empty: true }
                }
            ]
        },
        page_size: 100
    });

    const candidateTasks = tasksResponse.results;
    let milestonesCreated = 0;
    let tasksLinked = 0;
    let weekSynced = 0; // NEW: Track week sync operations

    for (const task of candidateTasks) {
        try {
            const taskProps = task.properties;
            const taskName = taskProps.Task?.title?.[0]?.text?.content || 'Untitled Task';
            const focusArea = taskProps['Focus Area']?.select?.name;
            const weekReference = taskProps['Week Reference']?.relation || [];
            
            // Create milestone
            const milestoneData = {
                parent: { database_id: MILESTONES_DB_ID },
                properties: {
                    'Task': {
                        title: [{ text: { content: taskName } }]
                    },
                    'Completed': { checkbox: false },
                    'Notes': {
                        rich_text: [{ text: { content: 'Auto-created from Task Bank' } }]
                    }
                }
            };

            // Add focus area if available
            if (focusArea) {
                milestoneData.properties['Focus Area'] = {
                    select: { name: focusArea }
                };
            }

            // Add Week Reference AND auto-sync Scorecard Week
            if (weekReference.length > 0) {
                const weekRefId = weekReference[0].id;
                
                milestoneData.properties['Week Reference'] = {
                    relation: weekReference
                };

                // NEW: Auto-sync Scorecard Week based on Week Reference
                const scorecardWeekId = WEEK_REFERENCE_TO_SCORECARD_MAPPING[weekRefId];
                if (scorecardWeekId && !scorecardWeekId.includes('WEEK_')) {
                    milestoneData.properties['Scorecard Week'] = {
                        relation: [{ id: scorecardWeekId }]
                    };
                    weekSynced++;
                    console.log(`✅ Auto-synced Scorecard Week for: ${taskName}`);
                }
            }

            const milestone = await notion.pages.create(milestoneData);
            milestonesCreated++;

            // Link task back to milestone
            await notion.pages.update({
                page_id: task.id,
                properties: {
                    'Linked to Weekly Milestone': {
                        relation: [{ id: milestone.id }]
                    }
                }
            });
            tasksLinked++;

        } catch (error) {
            console.error(`Error processing task: ${error.message}`);
        }
    }

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
                weekSynced // NEW: Include sync count
            }
        })
    };
}

// NEW FUNCTION: Sync Week References to Scorecard Weeks
async function syncWeekReferences(notion, headers) {
    console.log('Starting Week Reference → Scorecard Week sync...');

    try {
        // Get all milestones
        const milestonesResponse = await notion.databases.query({
            database_id: MILESTONES_DB_ID,
            page_size: 100
        });

        const milestones = milestonesResponse.results;
        let syncedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;

        for (const milestone of milestones) {
            try {
                const props = milestone.properties;
                const taskName = props.Task?.title?.[0]?.text?.content || 'Unknown';
                const weekReference = props['Week Reference']?.relation || [];
                const currentScorecard = props['Scorecard Week']?.relation || [];

                // Skip if no Week Reference
                if (weekReference.length === 0) {
                    skippedCount++;
                    continue;
                }

                const weekRefId = weekReference[0].id;
                const expectedScorecardId = WEEK_REFERENCE_TO_SCORECARD_MAPPING[weekRefId];

                // Skip if no mapping or placeholder
                if (!expectedScorecardId || expectedScorecardId.includes('WEEK_')) {
                    skippedCount++;
                    continue;
                }

                // Check if already synced
                const currentScorecardId = currentScorecard.length > 0 ? currentScorecard[0].id : null;
                if (currentScorecardId === expectedScorecardId) {
                    skippedCount++;
                    continue;
                }

                // Update Scorecard Week
                await notion.pages.update({
                    page_id: milestone.id,
                    properties: {
                        'Scorecard Week': {
                            relation: [{ id: expectedScorecardId }]
                        }
                    }
                });

                syncedCount++;
                console.log(`✅ Synced: ${taskName}`);

                // Small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 50));

            } catch (error) {
                errorCount++;
                console.error(`Error syncing milestone: ${error.message}`);
            }
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                message: 'Week Reference sync completed',
                summary: {
                    milestonesProcessed: milestones.length,
                    syncedCount,
                    skippedCount,
                    errorCount
                }
            })
        };

    } catch (error) {
        console.error('Week sync error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                success: false,
                error: 'Week sync failed',
                message: error.message
            })
        };
    }
}

// Helper function to get Week Reference ID by week number (if needed)
function getWeekReferenceId(weekNumber) {
    const weekReferenceIds = {
        1: "2421495c-e9ab-80d9-a954-e11c828688a9",
        2: "2421495c-e9ab-80b5-88ed-d428e228d346",
        3: "2421495c-e9ab-8113-9acc-c6986f533743",
        4: "2421495c-e9ab-812d-9fdc-c85af2665b7c",
        5: "2421495c-e9ab-8130-9ac5-f6a074f3a17a",
        6: "2421495c-e9ab-813c-9cf3-eba5b4f5576c",
        9: "2421495c-e9ab-81bb-811e-f9aa61eb3a39",
        10: "2421495c-e9ab-81d8-9680-df3499e4a322",
        11: "2421495c-e9ab-81da-b521-dc78ce8d0a74",
        12: "2421495c-e9ab-81e3-8f42-c977be4ab77b"
    };
    return weekReferenceIds[weekNumber];
}
