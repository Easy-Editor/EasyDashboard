update app.agent_run_costs
set billing_scope = 'project', payer_id = project_id
where profile = 'platform:default'
  and billing_scope = 'user'
  and payer_id = actor_id;
