alter table app.agent_project_contexts
  add column source_task_id text,
  add column provenance jsonb;

alter table app.agent_project_contexts
  add constraint agent_project_contexts_source_task_id_check
    check (source_task_id is null or length(trim(source_task_id)) between 1 and 160),
  add constraint agent_project_contexts_provenance_check
    check (
      provenance is null
      or case
        when jsonb_typeof(provenance) = 'object' then
          provenance ?& array['origin', 'sourceKinds']
          and provenance - 'origin' - 'sourceKinds' = '{}'::jsonb
          and provenance ->> 'origin' in ('agent_task', 'manual')
          and case
            when jsonb_typeof(provenance -> 'sourceKinds') = 'array' then
              jsonb_array_length(provenance -> 'sourceKinds') between 1 and 3
              and provenance -> 'sourceKinds' <@ '["user_request", "agent_plan", "agent_result"]'::jsonb
            else false
          end
        else false
      end
    );
