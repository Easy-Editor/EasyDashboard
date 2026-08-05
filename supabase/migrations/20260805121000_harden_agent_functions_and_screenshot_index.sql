alter function app.guard_agent_spike_operation_update()
  set search_path = '';

alter function app.guard_project_agent_model_configuration()
  set search_path = '';

alter function app.guard_agent_provider_attempt_update()
  set search_path = '';

alter function app.guard_agent_conversation_model_binding_update()
  set search_path = '';

create index agent_screenshot_artifacts_agent_operation_idx
  on app.agent_screenshot_artifacts(agent_operation_id);
