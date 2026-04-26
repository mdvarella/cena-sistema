// Netlify Function — Proxy para API Anthropic
// Evita CORS: o navegador chama esta função, ela chama a Anthropic server-side

exports.handler = async function(event, context) {
  // Aceitar apenas POST
  if(event.httpMethod !== 'POST'){
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // CORS headers para o Netlify app
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Preflight
  if(event.httpMethod === 'OPTIONS'){
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const body = JSON.parse(event.body);

    // Chamar a API Anthropic server-side (sem CORS)
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY, // variável de ambiente no Netlify
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    return {
      statusCode: response.status,
      headers,
      body: JSON.stringify(data)
    };

  } catch(err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
