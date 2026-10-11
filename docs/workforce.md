# Standard workforce

Every firm and every engagement gets the standard SOX workforce automatically, for IT general controls and business process controls. Nobody installs or staffs it by hand, in development or in production.

## Roster

The roster is code in `services/api/ai_workforce_api/workforce.py`. A test pins its fingerprint, so a change to any worker needs code review.

| Worker | Job | Allowed actions | Model tier |
| --- | --- | --- | --- |
| Engagement planner | Turns scope into a proposed task plan | `file.read`, `task.create` | reasoning |
| Evidence coordinator | Drafts PBC requests and reminders, tracks replies | `file.read`, `mail.draft`, `mail.pbc`, `mail.reminder`, `attachment.retrieve` | standard |
| ITGC tester: access | Provisioning, deprovisioning, privileged access, access reviews | `file.read`, `attachment.retrieve`, `workpaper.update` | standard |
| ITGC tester: change management | Request, test, approval, deployment, emergency changes | `file.read`, `attachment.retrieve`, `workpaper.update` | standard |
| ITGC tester: IT operations | Job monitoring, backup and restore, incidents | `file.read`, `attachment.retrieve`, `workpaper.update` | standard |
| Business process controls tester | Entity-level controls, business cycles (order to cash, procure to pay, record to report, treasury, payroll, inventory, fixed assets, tax), application controls, and key reports | `file.read`, `attachment.retrieve`, `workpaper.update` | standard |
| Independent reviewer | Reviews work it did not prepare | `file.read` | reasoning |
| Reporting analyst | Drafts findings and the report | `file.read`, `report.finalize` | reasoning |

Every allowed action must be in the action catalog. No standard worker may hold `permission.modify` or `mail.external`. Listing an action does not bypass policy: `mail.pbc`, `mail.reminder`, `workpaper.update`, and `report.finalize` still wait for a person's approval.

Model tiers are logical names. A later milestone maps `reasoning` and `standard` to real models through configuration, so the roster never names a vendor model.

## How it stays in place

The deploy step applies migrations and then syncs the roster:

```sh
python -m ai_workforce_api.migrate   # or: make migrate
```

The sync copies the roster into `standard_agents` and brings every firm up to date in one transaction:

- A firm missing a standard worker receives it.
- A standard worker follows the current roster. A firm's choice to disable one is kept.
- A worker removed from the roster is disabled in every firm.
- Every open engagement is staffed with the firm's active standard workers.

Database triggers keep this true between deploys, however a record is created:

- A new firm receives every standard worker.
- A new engagement is staffed with the firm's active standard workers. An archived engagement is not.
- A standard worker that is added or re-enabled joins every open engagement.

Each of these writes an audit event with no user actor. Running the sync again changes nothing.

## Who can change what

| | Owner | Admin | Project manager | Reviewer | Contributor |
| --- | --- | --- | --- | --- | --- |
| See standard and custom agents | Yes | Yes | Yes | Yes | Yes |
| Assign an agent to a task | Yes | Yes | Yes | No | Yes |
| Disable or re-enable a standard agent for the firm | Yes | Yes | No | No | No |
| Create or edit a custom agent | Yes | Yes | No | No | No |

Standard agents are locked. The API refuses any change other than status with `standard agents are managed by the platform`, and a database trigger refuses it too. Standard keys are reserved: a custom agent cannot use one.

To change how a standard worker behaves for one firm, an admin disables it and creates a custom agent. Custom agents are not staffed automatically.
