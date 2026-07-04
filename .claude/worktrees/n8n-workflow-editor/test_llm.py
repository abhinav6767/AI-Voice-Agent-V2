import asyncio, os
from livekit.plugins import google as google_plugin
from livekit.agents.llm import ChatContext
from dotenv import load_dotenv
load_dotenv()
api_key = os.getenv('GEMINI_API_KEY') or os.getenv('GOOGLE_API_KEY')
llm = google_plugin.LLM(api_key=api_key, model='gemini-2.5-flash-latest')
async def test():
    chat = ChatContext().append(text='hello', role='user')
    try:
        stream = await llm.chat(chat_ctx=chat)
        async for chunk in stream:
            if chunk.choices and chunk.choices[0].delta.content:
                print(chunk.choices[0].delta.content, end='')
    except Exception as e:
        print('ERROR:', repr(e))
asyncio.run(test())

