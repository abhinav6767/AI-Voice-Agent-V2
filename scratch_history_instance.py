import asyncio
from livekit.agents import AgentSession, Agent, TurnHandlingOptions
from unittest.mock import MagicMock

async def main():
    try:
        session = AgentSession(
            vad=MagicMock(), stt=MagicMock(), llm=MagicMock(), tts=MagicMock(), turn_handling=TurnHandlingOptions()
        )
        print("session.history type:", type(session.history))
        print("session.history attrs:", dir(session.history))
        if hasattr(session.history, 'messages'):
            print("session.history.messages:", session.history.messages)
    except Exception as e:
        print("error:", e)

if __name__ == "__main__":
    asyncio.run(main())
