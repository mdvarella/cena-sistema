exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'ANTHROPIC_API_KEY não configurada nas variáveis de ambiente do Netlify' })
    };
  }

  try {
    const body = JSON.parse(event.body);

    // Payload completo repassado à API — sem reconstruir nem filtrar
    // Suporta: texto, imagens (base64), documentos, multimodal
    const payload = {
      model:      body.model      || 'claude-sonnet-4-20250514',
      max_tokens: body.max_tokens || 1024,
      messages:   body.messages   || []
    };

    // system prompt é opcional
    if (body.system) payload.system = body.system;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':          apiKey,
        'anthropic-version':  '2023-06-01',
        'content-type':       'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    return {
      statusCode: response.status,
      headers: {
        'Content-Type':                'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(data)
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
