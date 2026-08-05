-- PostgreSQL requires UPDATE privilege for SELECT ... FOR UPDATE even when the
-- application only uses the lock to serialize immutable binding creation.
grant update on app.agent_conversation_model_bindings to easy_dashboard_runtime;
