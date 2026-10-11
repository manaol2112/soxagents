# Authorization

Milestone 2.4 decides who can read and change tenant data. Authentication only identifies the caller. The session cookie never carries a role.

The API loads the caller's active organization membership from PostgreSQL. A disabled user, a disabled membership, or a disabled organization has no access. An organization id in the URL is used only after that membership exists. `GET /organizations` ignores any tenant id supplied by the client and returns the caller's own memberships.

An unknown tenant or project is `404`. A member who lacks the action is `403`. Anything not listed below is denied.

| Action | Owner | Admin | Project manager | Reviewer | Contributor |
| --- | --- | --- | --- | --- | --- |
| Read the organization | Yes | Yes | Yes | Yes | Yes |
| Update the organization | Yes | Yes | No | No | No |
| Read memberships | Yes | Yes | No | No | No |
| Grant or change memberships | Any role | Project manager, reviewer, contributor | No | No | No |
| Read every project in the organization | Yes | Yes | No | No | No |
| Read a project or its tasks | Yes | Yes | Project member | Project member | Project member |
| Create a project | Yes | Yes | Yes | No | No |
| Update a project | Yes | Yes | Project member | No | No |
| Update a task | Yes | Yes | Project member | No | Project member |
| Read agent definitions | Yes | Yes | Yes | Yes | Yes |
| Create or update a custom agent; disable or enable a standard agent | Yes | Yes | No | No | No |

Owners and admins can read every project in their organization. Other roles also need a `project_memberships` row. Project creation is allowed for a project manager without an existing project membership. Project and task updates are not.

A new project starts as `DRAFT` or `ACTIVE`. `ACTIVE` can pause to `PAUSED` and resume to `ACTIVE`. `DRAFT`, `ACTIVE`, and `PAUSED` can be archived. An archived project stays in the database with its audit history, and its status does not move backward. Creating or changing a project writes an `audit_events` row in the same transaction. The owner must be an active member of that organization.

A task belongs to one project. People who can update a task can create it, assign an active project member, and change its status. A reviewer can read tasks and cannot change them. A normal save cannot leave `CANCELLED`. Reactivation is a separate operation and returns the task to `DRAFT`. Retry is a separate operation from `FAILED` to `READY`, and it stops when `retry_count` reaches `max_retries`. A dependency that points at the task itself, another project, or a cycle is rejected. A task cannot enter `QUEUED` or `RUNNING` while a predecessor is not `SUCCEEDED`. A task cannot be assigned to an agent instance whose definition is disabled, or to an instance outside the project. Each change writes an `audit_events` row in the same transaction. The payload records status only.

An agent definition belongs to the organization. Every member can read it. Owners and admins can create a custom agent and move any agent between `ACTIVE` and `DISABLED`. Standard agents come from the platform roster and are locked; see `docs/workforce.md`. The definition stores `model_config_ref` as a name. Schemas and text that carry a secret value are rejected and are not written. Disabling a definition does not change instance rows that are already `RUNNING` or `WAITING`; those executions may still reach a terminal status. A disabled definition cannot gain a new instance, and an instance that is not already running cannot enter `RUNNING` or `WAITING`. Creating or changing a definition writes an `audit_events` row in the same transaction. The payload records status and revision only.

A manager plan belongs to one project. People who can update a task can ask for a plan. A reviewer can read it and cannot ask. The manager creates draft tasks only when the project is active, each title is a full phrase from the objective or exactly a written blocker, and the plan stays inside its limits. A proposal that invents a title, deadline, approval, or completed result is recorded as a clarification and creates nothing. A request to send email, grant a role, or execute a tool is escalated and creates nothing.

A worker result belongs to one project and one task. People who can update a task can submit it. A reviewer can read it and cannot submit it. The task must already be running, waiting, blocked, or in review. The agent definition must be active, and the submitted revision must be that definition's current revision. The same operation key returns the recorded result. A new key records the next version for that task. The row stores schema version 1, the summary, structured output, artifact and evidence references, errors, limitations, proposed actions, and an optional review request. It does not change the task, execute an action, send email, or grant an approval. A secret, a policy action, or a blank success is rejected and is not stored.

A model call belongs to one project. People who can update a task can request a structured generation or a tool proposal. A reviewer can read the recorded outcome and cannot request one. The recorded row stores status, token counts, and cost. It does not store the prompt, the model output, or a provider key. A tool proposal is not executed.

When a durable engine address is configured, starting a run also submits that run to the engine. The submission carries identifiers only. A secret in a workflow field is still rejected. If the engine does not accept the run, the API reports that workflow execution is unavailable and the stored run can be submitted again.

A workflow run belongs to one project. People who can update a task can start it, pause it, resume it, cancel it, finish it, signal it, and retry a failure. A reviewer can read the run and its history and cannot change them. Starting the same key again returns the open run. A finished key stays reserved. A signal payload that contains a secret is rejected and is not written. Each change writes an `audit_events` row whose payload records status only. The event list is separate and append-only.

The action catalog names the operations the platform may later perform. Every member can read it. A person who can read a project can check a proposal against that catalog. The check confirms the action is registered and that its fields match the declared rules. It does not create a task, draft or send email, change a membership, or write an approval. `permission.modify` cannot name an owner or admin role. Live email and tool execution stay off.

The policy engine answers allow or deny for one registered action on one project. Unknown actions are denied. A field that does not match the catalog is denied, including a field a model uses to call the action safe. The caller must hold the action's declared permission. An owner or admin can deny an action for the whole organization or for one project. A paused, draft, or archived project denies every action except a read. A person cannot change their own membership, and an agent cannot change permissions. The decision does not execute the action. A secret is rejected and is not stored.

An approval is required when the catalog says so. A person who can update tasks can request one after the policy allows the action. The row stores the exact parameters, the target, the risk, and a hash of that payload. The same pending request returns the existing approval. A changed recipient, attachment, or other parameter is a new approval, and approving the first does not approve the second. The requester cannot approve it. A project approval can be decided by someone who can update the project. An organization approval can be decided by an owner or admin. A pending approval expires after 24 hours. Deciding an approval does not perform the action. A secret is rejected and is not stored.

Execution checks the schema, asks the policy engine again, and requires an approved, unexpired approval when the catalog requires one. The approval must match the same parameters. A draft task is created only after those checks. Email, attachment retrieval, workpaper updates, and report finalization are refused and are not performed. A permission change applies only to a member who is not an owner or admin, and only after an organization approval. Repeating the same payload returns the recorded outcome and does not perform it again, including when two requests arrive together. An agent cannot take that path. A missing project, membership, or approval fails closed.

An approved mail action records one mock message. The sender is the mock shared mailbox. The message is a draft or accepted by the mock, and it is not marked delivered. A provider name other than the mock refuses the action. Graph settings may be present in the environment, and the platform may use only the one configured shared mailbox. Live email stays disabled. See [mailbox.md](mailbox.md).

A PBC request belongs to one project. People who can update a task can create it and move it through the statuses in [pbc.md](pbc.md). A reviewer can read it and cannot change it. The same operation key returns the recorded request. A new request requires an active project. The recipient stays bound once the request leaves draft. Recording a sent status requires a mailbox message that already exists, and the transition does not send another message. The audit payload stores the status only.

A user cannot grant or change their own membership. An agent is not a principal and cannot grant roles. Only an owner can change an owner membership, so the last owner cannot be removed by anyone else, and they cannot remove themselves.

Membership changes write an `audit_events` row in the same transaction. The catalog declares email and permission actions, and those actions still do not execute.
