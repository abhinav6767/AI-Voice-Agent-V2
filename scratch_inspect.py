from livekit.agents import AgentSession
print("AgentSession annotations:", getattr(AgentSession, '__annotations__', {}))
import inspect
for name, prop in inspect.getmembers(AgentSession):
    if isinstance(prop, property):
        print(f"Property: {name}")
