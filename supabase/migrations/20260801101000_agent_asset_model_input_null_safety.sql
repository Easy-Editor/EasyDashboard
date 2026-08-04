alter table app.agent_assets
  drop constraint agent_assets_model_input_all_or_none_check,
  add constraint agent_assets_model_input_all_or_none_check
    check (
      (model_input_bytes is null and model_input_content_type is null and model_input_sha256 is null and model_input_size is null)
      or (
        model_input_bytes is not null
        and model_input_content_type is not null
        and model_input_content_type in ('image/png', 'image/jpeg', 'image/webp')
        and model_input_sha256 is not null
        and model_input_sha256 ~ '^[a-f0-9]{64}$'
        and model_input_size is not null
        and model_input_size between 1 and 4194304
        and octet_length(model_input_bytes) = model_input_size
      )
    );
