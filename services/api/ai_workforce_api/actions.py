"""Registered actions. The catalog declares rules. It does not execute them."""

import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from ai_workforce_api.authorization import (
    Action,
    Principal,
    _call,
    _session_principal,
    authorize,
)
from ai_workforce_api.settings import Settings

Risk = Literal["LOW", "MODERATE", "HIGH"]
Approval = Literal["NONE", "PROJECT", "ORGANIZATION"]
FieldKind = Literal["reference", "email", "text", "role"]
_REFERENCE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,200}$")
_EMAIL = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
_ROLES = frozenset({"PROJECT_MANAGER", "REVIEWER", "CONTRIBUTOR"})
_SECRET_TEXT = re.compile(
    r"(?i)(api[_-]?key|client[_-]?secret|refresh[_-]?token|access[_-]?token|password|"
    r"private[_-]?key)\s*[:=]|sk-[A-Za-z0-9]|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY"
)


class ActionUnknown(Exception):
    """The action id is not in the catalog."""


@dataclass(frozen=True)
class ActionField:
    name: str
    kind: FieldKind
    max_length: int


@dataclass(frozen=True)
class ActionType:
    action_id: str
    name: str
    permission: Action
    risk: Risk
    approval: Approval
    fields: tuple[ActionField, ...]


CATALOG: tuple[ActionType, ...] = (
    ActionType(
        "file.read",
        "Read project file",
        Action.TASK_READ,
        "LOW",
        "NONE",
        (ActionField("resource_ref", "reference", 200),),
    ),
    ActionType(
        "task.create",
        "Create internal task",
        Action.TASK_UPDATE,
        "LOW",
        "NONE",
        (ActionField("title", "text", 200),),
    ),
    ActionType(
        "mail.draft",
        "Draft email",
        Action.TASK_UPDATE,
        "MODERATE",
        "NONE",
        (ActionField("recipient", "email", 200), ActionField("subject", "text", 200)),
    ),
    ActionType(
        "mail.pbc",
        "Send routine PBC request",
        Action.TASK_UPDATE,
        "MODERATE",
        "PROJECT",
        (
            ActionField("recipient", "email", 200),
            ActionField("subject", "text", 200),
            ActionField("request_ref", "reference", 200),
        ),
    ),
    ActionType(
        "mail.reminder",
        "Send PBC reminder",
        Action.TASK_UPDATE,
        "MODERATE",
        "PROJECT",
        (
            ActionField("recipient", "email", 200),
            ActionField("subject", "text", 200),
            ActionField("request_ref", "reference", 200),
        ),
    ),
    ActionType(
        "mail.external",
        "Send sensitive external email",
        Action.TASK_UPDATE,
        "HIGH",
        "ORGANIZATION",
        (ActionField("recipient", "email", 200), ActionField("subject", "text", 200)),
    ),
    ActionType(
        "attachment.retrieve",
        "Retrieve attachment",
        Action.TASK_READ,
        "MODERATE",
        "PROJECT",
        (ActionField("attachment_ref", "reference", 200),),
    ),
    ActionType(
        "workpaper.update",
        "Update workpaper",
        Action.TASK_UPDATE,
        "HIGH",
        "PROJECT",
        (
            ActionField("workpaper_ref", "reference", 200),
            ActionField("change_summary", "text", 500),
        ),
    ),
    ActionType(
        "permission.modify",
        "Modify permissions",
        Action.MEMBERSHIP_GRANT,
        "HIGH",
        "ORGANIZATION",
        (ActionField("target_user_ref", "reference", 200), ActionField("role", "role", 40)),
    ),
    ActionType(
        "report.finalize",
        "Finalize report",
        Action.PROJECT_UPDATE,
        "HIGH",
        "ORGANIZATION",
        (ActionField("report_ref", "reference", 200),),
    ),
)
_BY_ID = {item.action_id: item for item in CATALOG}


class ActionFieldBody(BaseModel):
    name: str
    kind: str
    max_length: int


class ActionBody(BaseModel):
    action_id: str
    name: str
    permission: str
    risk: str
    approval: str
    fields: list[ActionFieldBody]


class ActionCheck(BaseModel):
    action_id: str = Field(pattern=r"^[a-z]+(?:[.][a-z]+)*$", max_length=40)
    parameters: dict[str, str] = Field(default_factory=dict)


class ActionCheckBody(BaseModel):
    action_id: str
    permission: str
    risk: str
    approval: str
    accepted: Literal[True]


def register_actions(app: FastAPI, settings: Settings) -> None:
    @app.get(
        "/organizations/{organization_id}/actions",
        response_model=list[ActionBody],
    )
    def list_actions(organization_id: UUID, request: Request) -> list[ActionBody]:
        principal = _session_principal(request)
        _run(
            settings,
            lambda connection: _visible(connection, principal, organization_id),
        )
        return [_body(item) for item in CATALOG]

    @app.post(
        "/organizations/{organization_id}/projects/{project_id}/actions/check",
        response_model=ActionCheckBody,
    )
    def check_action(
        organization_id: UUID,
        project_id: UUID,
        body: ActionCheck,
        request: Request,
    ) -> ActionCheckBody:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: _check(connection, principal, organization_id, project_id, body),
        )


def _visible(
    connection: psycopg.Connection[Any], principal: Principal, organization_id: UUID
) -> None:
    authorize(
        connection,
        principal=principal,
        action=Action.ORGANIZATION_READ,
        organization_id=organization_id,
    )


def _check(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: ActionCheck,
) -> ActionCheckBody:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_READ,
        organization_id=organization_id,
        project_id=project_id,
    )
    action = _BY_ID.get(body.action_id)
    if action is None:
        raise ActionUnknown()
    _parameters(action, body.parameters)
    return ActionCheckBody(
        action_id=action.action_id,
        permission=action.permission.value,
        risk=action.risk,
        approval=action.approval,
        accepted=True,
    )


def find_action(action_id: str) -> ActionType | None:
    return _BY_ID.get(action_id)


def parameters_ok(action: ActionType, parameters: dict[str, str]) -> bool:
    try:
        _parameters(action, parameters)
    except ValueError:
        return False
    return True


def contains_secret(parameters: dict[str, str]) -> bool:
    return any(_SECRET_TEXT.search(value) for value in parameters.values())


def _parameters(action: ActionType, parameters: dict[str, str]) -> None:
    expected = {field.name for field in action.fields}
    if set(parameters) != expected or len(parameters) > 8:
        raise ValueError("action fields are invalid")
    for field in action.fields:
        value = parameters[field.name].strip()
        if value == "" or len(value) > field.max_length or _SECRET_TEXT.search(value):
            raise ValueError("action fields are invalid")
        if field.kind == "reference" and _REFERENCE.fullmatch(value) is None:
            raise ValueError("action fields are invalid")
        if field.kind == "email" and _EMAIL.fullmatch(value) is None:
            raise ValueError("action fields are invalid")
        if field.kind == "role" and value not in _ROLES:
            raise ValueError("action fields are invalid")


def _body(action: ActionType) -> ActionBody:
    return ActionBody(
        action_id=action.action_id,
        name=action.name,
        permission=action.permission.value,
        risk=action.risk,
        approval=action.approval,
        fields=[
            ActionFieldBody(name=field.name, kind=field.kind, max_length=field.max_length)
            for field in action.fields
        ],
    )


def _run[T](settings: Settings, work: Callable[[psycopg.Connection[Any]], T]) -> T:
    try:
        result: T = _call(settings, work)
    except ActionUnknown:
        raise HTTPException(status_code=422, detail="action is not registered") from None
    except ValueError:
        raise HTTPException(status_code=422, detail="action fields are invalid") from None
    return result
