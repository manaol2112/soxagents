# Client portal: final submission smoke test (headless Chrome, ai_workforce_scale)

- Link minted for iam@client.example on ITGC-AC-07 · Salesforce (request 01a15b59); a second link minted and revoked by the team. SIMULATED: no email went out; tokens are hashed at rest.
- Opened the link, asked for the code: clicked: Email me a code; typed the previewed code; clicked: Continue
- The list offered: [{"t":"5\nAll requests","h":null,"d":""},{"t":"3\nAwaiting your response","h":null,"d":""},{"t":"2\nIn progress","h":null,"d":""},{"t":"0\nSubmitted","h":null,"d":""},{"t":"0\nCompleted","h":null,"d":""},{"t":"Interim testing evidence for ITGC-AC-07:","h":"?request=01a15b59-6056-7710-9a90-c60b92994503","d":""},{"t":"Interim testing evidence for ITGC-AC-07:","h":"?request=01a15b59-615b-7d6f-a19f-cd457eda0c9f","d":""},{"t":"Interim testing evidence for ITGC-AC-07:","h":"?request=01a15b59-6389-759d-85a5-8d9f9ad744e6","d":""},{"t":"Interim testing evidence for ITGC-AC-07:","h":"?request=01a15b59-6470-7711-80f6-c81da5dfa906","d":""},{"t":"Interim testing evidence for ITGC-AC-07:","h":"?request=01a15b59-6259-77b3-804a-f09decddef98","d":""}]
- Opened the request: opened by id: Interim testing evidence for ITGC-AC-07: User Acce → {'heading': 'Interim testing evidence for ITGC-AC-07: User Access Modification upon Transfer', 'ref': 'PBC-9AD744E6'}; uploads acknowledged: {"received":["owner-item-1.csv","owner-item-2.csv"],"progress":"2 of 2 items with files"}
- Final submission: clicked: Submit evidence → confirmation dialog {'dialogOpen': True, 'focusInside': True, 'text': 'Submit evidence for PBC-9AD744E6\n\nEvery item has at least one file. The audit team is told the request is ready for review.\n\nNote to the audit team (optional)\nCancel\nSubmit'}; Tab stays inside: False; confirmed: Submit
- The page after submitting says: ['Submitted', 'owner-item-1.csv was received.', 'owner-item-2.csv was received.', 'Submitted Oct 21, 2026']
- Request status SENT → SENT; owner submitted at 2026-10-21 00:09:05.674416+00:00; audit events ['evidence.portal_submitted', 'pbc.updated', 'pbc.updated']; files on the request: ['owner-item-1.csv', 'owner-item-2.csv']; engagement 01a15b58, control ITGC-AC-07 · Salesforce.
- A wrong token: AI Workforce | Evidence Portal | Help | This link is not valid
- The revoked link: AI Workforce | Evidence Portal | scale-25f3ad40 | SOX 2027; asking for a code: not found: Email me a code
- API: the revoked link answered 200 (the status says revoked; see the page)
- API: a code for the revoked link is refused with 409
- Outbound email was not exercised: no sender is configured; the code was shown as a local preview, as the page says.
