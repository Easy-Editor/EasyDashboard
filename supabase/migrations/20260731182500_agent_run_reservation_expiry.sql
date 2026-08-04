alter table app.agent_run_costs
  add column reservation_expires_at timestamptz;

update app.agent_run_costs
set reservation_expires_at = updated_at + interval '10 minutes'
where reservation_expires_at is null;

alter table app.agent_run_costs
  alter column reservation_expires_at set not null,
  add constraint agent_run_costs_reservation_expiry_check
    check (reservation_expires_at >= created_at);

create index agent_run_costs_reserved_expiry_idx
  on app.agent_run_costs(reservation_expires_at)
  where state = 'reserved';

comment on column app.agent_run_costs.reservation_expires_at is
  'Bound after which an unissued reserved run is reconciled to billing_indeterminate instead of remaining in planning forever.';
