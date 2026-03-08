export async function onRequest(context) {
    const { channelId } = context.params;
  
    try {
      const response = await fetch(
        `https://api.chzzk.naver.com/service/v1/channels/${channelId}/live-detail`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'Referer': 'https://chzzk.naver.com',
          },
        }
      );
  
      const data = await response.json();
  
      return new Response(JSON.stringify(data), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
  
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
  }