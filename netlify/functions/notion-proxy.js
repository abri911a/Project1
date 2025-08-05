// netlify/functions/task-automation.js
exports.handler = async (event, context) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { token } = JSON.parse(event.body);

    if (!token) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing token' })
      };
    }

    console.log('Starting task automation...');

    // Database IDs
    const TASKS_DB_ID = 'e1cdae69-6ef0-442f-9777-01c2d7473b66';
    const MILESTONES_DB_ID = 'dab40b08-41d9-4457-bb96-471835d466b7';

    // Fetch Tasks Bank database - only get Planned tasks with Week Reference
    const tasksResponse = await fetch(`https://api.notion.com/v1/databases/${TASKS_DB_ID}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        filter: {
          and: [
            {
              property: 'Status',
              select: {
                equals: '📅 Planned'
              }
            },
            {
              property: 'Linked to Weekly Milestone',
              relation: {
                is_empty: true
              }
            },
            {
              property: 'Week Reference',
              relation: {
                is_not_empty: true
              }
            }
          ]
        },
        page_size: 100
      })
    });

    if (!tasksResponse.ok) {
      throw new Error(`Tasks API error: ${tasksResponse.status}`);
    }

    const tasksData = await tasksResponse.json();
    const tasksToProcess = tasksData.results;

    console.log(`Found ${tasksToProcess.length} planned tasks with week references ready to process`);

    let createdMilestones = 0;
    let linkedTasks = 0;
    const results = [];

    // Process each task
    for (const task of tasksToProcess) {
      try {
        const taskTitle = task.properties.Task?.title?.[0]?.text?.content || 'Untitled Task';
        const focusArea = task.properties['Focus Area']?.select?.name || 'Career';
        const priority = task.properties.Priority?.select?.name || '⚡ Medium';
        const notes = task.properties.Notes?.rich_text?.[0]?.text?.content || '';
        const dueDate = task.properties['Due Date']?.date?.start || null;
        const estimatedHours = task.properties['Estimated Hours']?.number || null;
        
        // Get Week Reference - this is the key for matching
        const weekReference = task.properties['Week Reference']?.relation?.[0]?.id;
        
        if (!weekReference) {
          console.log(`Skipping task ${taskTitle} - no week reference`);
          continue;
        }

        console.log(`Processing task: ${taskTitle} with week reference: ${weekReference}`);

        // Create milestone in Weekly Milestones database
        const milestoneData = {
          parent: { database_id: MILESTONES_DB_ID },
          properties: {
            'Task': {
              title: [
                {
                  text: {
                    content: taskTitle
                  }
                }
              ]
            },
            'Focus Area': {
              select: {
                name: focusArea
              }
            },
            'Completed': {
              checkbox: false
            },
            'Week Reference': {
              relation: [
                {
                  id: weekReference
                }
              ]
            },
            'Notes': {
              rich_text: [
                {
                  text: {
                    content: `Auto-created from planned task: ${taskTitle}${notes ? '\n\nOriginal notes: ' + notes : ''}${estimatedHours ? '\n\nEstimated hours: ' + estimatedHours : ''}`
                  }
                }
              ]
            }
          }
        };

        // Add due date if present
        if (dueDate) {
          milestoneData.properties['Due Date'] = {
            date: {
              start: dueDate
            }
          };
        }

        // Set deadline type based on priority
        let deadlineType = 'Flexible';
        if (priority === '🔥 High') {
          deadlineType = 'Critical (Fixed)';
        } else if (priority === '⚡ Medium') {
          deadlineType = 'Target';
        }

        milestoneData.properties['Deadline Type'] = {
          select: {
            name: deadlineType
          }
        };

        // Create the milestone
        const createResponse = await fetch('https://api.notion.com/v1/pages', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(milestoneData)
        });

        if (!createResponse.ok) {
          const errorText = await createResponse.text();
          console.error(`Failed to create milestone for task ${taskTitle}:`, errorText);
          continue;
        }

        const newMilestone = await createResponse.json();
        createdMilestones++;

        // Link the task back to the milestone
        const updateTaskResponse = await fetch(`https://api.notion.com/v1/pages/${task.id}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            properties: {
              'Linked to Weekly Milestone': {
                relation: [
                  {
                    id: newMilestone.id
                  }
                ]
              },
              'Status': {
                select: {
                  name: '🚀 In Progress'
                }
              }
            }
          })
        });

        if (updateTaskResponse.ok) {
          linkedTasks++;
          results.push({
            taskTitle,
            milestoneId: newMilestone.id,
            weekReference,
            success: true
          });
          console.log(`✅ Successfully processed: ${taskTitle}`);
        } else {
          const linkError = await updateTaskResponse.text();
          console.error(`Failed to link task ${taskTitle}:`, linkError);
          results.push({
            taskTitle,
            milestoneId: newMilestone.id,
            weekReference,
            success: false,
            error: 'Failed to link task back to milestone'
          });
        }

      } catch (error) {
        console.error(`Error processing task:`, error);
        results.push({
          taskTitle: task.properties.Task?.title?.[0]?.text?.content || 'Unknown',
          success: false,
          error: error.message
        });
      }
    }

    console.log(`Automation complete: ${createdMilestones} milestones created, ${linkedTasks} tasks linked`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        summary: {
          tasksProcessed: tasksToProcess.length,
          milestonesCreated: createdMilestones,
          tasksLinked: linkedTasks
        },
        details: results
      })
    };

  } catch (error) {
    console.error('Automation error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        success: false,
        error: 'Internal server error',
        details: error.message
      })
    };
  }
};
