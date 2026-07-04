import asyncio, os, certifi
os.environ['SSL_CERT_FILE'] = certifi.where()
from dotenv import load_dotenv; load_dotenv('.env')
from livekit import api

async def main():
    lk = api.LiveKitAPI(url=os.getenv('LIVEKIT_URL'), api_key=os.getenv('LIVEKIT_API_KEY'), api_secret=os.getenv('LIVEKIT_API_SECRET'))

    try:
        await lk.sip.delete_dispatch_rule(api.DeleteSIPDispatchRuleRequest(sip_dispatch_rule_id='SDR_6i2FS2GUz3Qy'))
        print('Deleted broken rule SDR_6i2FS2GUz3Qy')
    except Exception as e:
        print('Failed to delete:', e)

    req = api.CreateSIPDispatchRuleRequest(
        name='act-foundation-dispatch',
        trunk_ids=['ST_RjMaoYbzGuvn'],
        rule=api.SIPDispatchRule(
            dispatch_rule_individual=api.SIPDispatchRuleIndividual(
                room_prefix='ws-5bfbd7f2-',
                pin='',
            )
        ),
        room_config=api.RoomConfiguration(
            metadata='{"workspace_id":"5bfbd7f2-a242-4b4c-92b3-9f993558c92d"}',
            agents=[api.RoomAgentDispatch(agent_name='inbound-caller')]
        )
    )

    try:
        result = await lk.sip.create_dispatch_rule(req)
        print('Created new rule:', result.sid)
    except Exception as e:
        print('Failed to create:', e)

    await lk.aclose()

asyncio.run(main())
