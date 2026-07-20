# Kling VIDEO 3.0 Omni fixtures

Pinned from the official KlingAI Open Platform contract on July 20, 2026.

- Authentication: `Authorization: Bearer {apikey}`; Access Key/Secret Key is legacy only.
- Base URL: `https://api-singapore.klingai.com`.
- Create: `POST /omni-video/kling-3.0-omni`.
- Query: `GET /tasks?task_ids={validatedTaskId}`.
- Statuses: `submitted`, `processing`, `succeeded`, `failed`.
- Generated artifacts are retained for 30 days after `update_time`.
- The `expired.json` fixture exercises the runtime retention guard; `expired` is not an official status enum.
- Current adapter accepts the official URL resource form and rejects ambiguous provider-neutral bare base64 resources.
- The current official contract does not expose a remote cancel route.

Official schema locators:

- https://kling.ai/document-api/api/get-started/authentication
- https://kling.ai/document-api/api/video/3-0-omni/video-omni
