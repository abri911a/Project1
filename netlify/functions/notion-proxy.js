// netlify/functions/notion-proxy-debug.js
// Alternative simplified version for debugging

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
    const { token, tasksDbId, milestonesDbId } = JSON.parse(event.body);

    if (!token || !tasksDbId || !milestonesDbId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing token, tasksDbId, or milestonesDbId' })
      };
    }

    console.log('Fetching Tasks Bank database...');
    
    // Fetch Tasks Bank database (simplified)
    const tasksResponse = await fetch(`https://api.notion.com/v1/databases/${tasksDbId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        page_size: 100
      })
    });

    if (!tasksResponse.ok) {
      const errorText = await tasksResponse.text();
      console.error('Tasks API error:', errorText);
      return {
        statusCode: tasksResponse.status,
        headers,
        body: JSON.stringify({ 
          error: `Tasks API error: ${tasksResponse.status}`,
          details: errorText
        })
      };
    }

    const tasksData = await tasksResponse.json();
    console.log(`Fetched ${tasksData.results.length} tasks`);

    console.log('Fetching Weekly Milestones database...');

    // Fetch Weekly Milestones database
    const milestonesResponse = await fetch(`https://api.notion.com/v1/databases/${milestonesDbId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        page_size: 100
      })
    });

    if (!milestonesResponse.ok) {
      const errorText = await milestonesResponse.text();
      console.error('Milestones API error:', errorText);
      return {
        statusCode: milestonesResponse.status,
        headers,
        body: JSON.stringify({ 
          error: `Milestones API error: ${milestonesResponse.status}`,
          details: errorText
        })
      };
    }

    const milestonesData = await milestonesResponse.json();
    console.log(`Fetched ${milestonesData.results.length} milestones`);

    // Create a simple map of milestone IDs to milestone data
    const milestonesMap = {};
    milestonesData.results.forEach(milestone => {
      milestonesMap[milestone.id] = milestone;
    });

    console.log('Processing tasks with milestone data...');

    // Process tasks and add completion status from milestones
    const enrichedTasks = tasksData.results.map(task => {
      // Get linked milestones
      const linkedMilestones = task.properties['Linked to Weekly Milestone']?.relation || [];
      
      let isCompleted = false;
      let milestoneData = null;

      if (linkedMilestones.length > 0) {
        // Get the first linked milestone
        const milestoneId = linkedMilestones[0].id;
        milestoneData = milestonesMap[milestoneId];
        
        if (milestoneData) {
          // Check if milestone is completed
          isCompleted = milestoneData.properties.Completed?.checkbox === true;
        }
      }

      // Determine computed status
      let computedStatus;
      if (isCompleted) {
        computedStatus = '✅ Completed';
      } else if (linkedMilestones.length > 0) {
        computedStatus = '🚀 In Progress';
      } else {
        computedStatus = task.properties.Status?.select?.name || '📝 Draft';
      }

      return {
        ...task,
        computedStatus: computedStatus,
        milestoneData: milestoneData
      };
    });

    const tasksWithMilestones = enrichedTasks.filter(t => t.milestoneData).length;

    console.log(`Processed ${enrichedTasks.length} tasks, ${tasksWithMilestones} with milestones`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        results: enrichedTasks,
        milestones: milestonesData.results,
        totalTasks: enrichedTasks.length,
        tasksWithMilestones: tasksWithMilestones,
        debug: {
          tasksCount: tasksData.results.length,
          milestonesCount: milestonesData.results.length,
          enrichedTasksCount: enrichedTasks.length,
          timestamp: new Date().toISOString()
        }
      })
    };

  } catch (error) {
    console.error('Proxy error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Internal server error',
        details: error.message,
        stack: error.stack
      })
    };
  }
};
