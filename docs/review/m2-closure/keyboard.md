# Keyboard-only checks (headless Chrome, real key events)

## 1. Guided control stepper
- Tab order from the first step: ['Request', '3\nTest\nInterim operating effectiveness: results to', '4\nConclude', '5\nReview', 'Activity', 'Open']
- Focus visible on every stop: yes
- Enter on the Test step: A 3
Test
Interim operating effectiveness: results to confirm → address 58-db83-7b13-a7ef-0a0a0b5c5723&step=test (opened)

## 2. Plan review and approval actions
- Tab reaches the action buttons: ['2 things to settle when they can be\nDoes not preve', 'Open the standard', 'Record the values']
- Enter on Request changes: {'formOpen': True, 'focusedIn': True, 'active': 'BUTTON Request changes'}; next Tab: ['']
- Values dialog: {'dialogOpen': False, 'focusInside': False, 'active': 'TEXTAREA '}; Tab stays inside: False (['Cancel', '2 things to settle when they can be\nDoes not preve', 'Open the standard', 'Record the values', 'Release roll-forward early', 'Understanding\n12\n1\nneed a look']); Escape closes: {'dialogOpen': False, 'active': 'BUTTON Understanding\n12\n1\nneed a look'}

## 3. The canonical queue (Home)
- Tab order from the first filter: ['My actions\n304', 'Blocked\n8', 'Waiting on others\n4', 'Upcoming\n1', 'Every stage', 'Test plans', 'Evidence', 'Testing', 'Review', 'Every phase', 'Interim', 'Design', 'Roll-forward', 'Retest']
- Focus visible on every stop: yes
- Enter on a row's Open: A Open: Confirm the testing basis of the roll-forward round → opened the control

## 4. Testing Results and Review phone details
- Focus on the first Details: SUMMARY Details, visible {'on': 'SUMMARY Details', 'focusVisible': True, 'outline': True, 'shadow': False}
- Enter opens: True; Space toggles: False; next stops: ['Open', 'ITGC-AC-01']
- Review cards: Tab lands on SUMMARY Details (visible: [(True, True)]); Enter opens: True; next stop: ['Open']

## 5. A modal dialog (status and close-out)
- On open: {'dialogOpen': True, 'focusInside': True, 'active': 'DIV NO CLIENT\n\nSOX 2027\n\nPeriod end Dec 31, 2027 Â· Lead Dana Whi'}
- Tab stays inside the dialog: True (['Close', 'Edit details', 'Pause', 'Archive', 'ITGC-AC-01 Â· Salesforce: test not signed off', 'ITGC-AC-01 Â· ServiceNow: test not signed off', 'ITGC-AC-01 Â· Workday: test not signed off', 'ITGC-AC-02 Â· Oracle EBS: test not signed off', 'ITGC-AC-02 Â· Salesforce: test not signed off', 'ITGC-AC-02 Â· SAP ERP: test not signed off'])
- Escape closes: {'dialogOpen': False, 'active': 'BODY Skip to content\nAI Workforce\nscale-25f3ad40\n\nENGAGEMENT\n\nHom'}
