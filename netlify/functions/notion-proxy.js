// netlify/functions/notion-proxy.js
exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

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

  try {
    const { token, tasksDbId, milestonesDbId } = JSON.parse(event.body);

    if (!token || !tasksDbId || !milestonesDbId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing token, tasksDbId, or milestonesDbId' })
      };
    }

    // Fetch Tasks Bank database
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
      return {
        statusCode: tasksResponse.status,
        headers,
        body: JSON.stringify({ 
          error: `Tasks API error: ${tasksResponse.status}`,
          details: errorText
        })
      };
    }

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
      return {
        statusCode: milestonesResponse.status,
        headers,
        body: JSON.stringify({ 
          error: `Milestones API error: ${milestonesResponse.status}`,
          details: errorText
        })
      };
    }

    const tasksData = await tasksResponse.json();
    const milestonesData = await milestonesResponse.json();

    // Create a map of milestone URLs to milestone data for quick lookup
    const milestonesMap = {};
    milestonesData.results.forEach(milestone => {
      milestonesMap[milestone.url] = milestone;
    });

    // Enrich tasks with milestone completion status
    const enrichedTasks = tasksData.results.map(task => {
      // Get linked milestones
      const linkedMilestones = task.properties['Linked to Weekly Milestone']?.relation || [];
      
      // Find completion status from linked milestones
      let isCompleted = false;
      let isInProgress = false;
      let milestoneData = null;

      if (linkedMilestones.length > 0) {
        // Get the first linked milestone (assuming one-to-one relationship)
        const milestoneUrl = linkedMilestones[0].id;
        milestoneData = Object.values(milestonesMap).find(m => m.id === milestoneUrl);
        
        if (milestoneData) {
          isCompleted = milestoneData.properties.Completed?.checkbox === true;
          // You can define "in progress" logic based on your workflow
          // For now, let's say in progress = has milestone but not completed
          isInProgress = !isCompleted;
        }
      }

      return {
        ...task,
        // Add computed status based on milestone
        computedStatus: isCompleted ? '✅ Completed' : 
                       isInProgress ? '🚀 In Progress' : 
                       task.properties.Status?.select?.name || '📝 Draft',
        milestoneData: milestoneData
      };
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        results: enrichedTasks,  // Change from 'tasks' to 'results' to match expected format
        milestones: milestonesData.results,
        totalTasks: enrichedTasks.length,
        tasksWithMilestones: enrichedTasks.filter(t => t.milestoneData).length
      })
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Internal server error',
        details: error.message
      })
    };
  }
};
