
create or replace function public.refresh_ai_model_registry_score_summaries(
  p_score_version text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ai_model_registry r
  set score_summary = coalesce(
        (
          select jsonb_object_agg(
            s.task_type,
            jsonb_build_object(
              'capabilityFit', s.capability_fit_score,
              'quality', s.quality_score,
              'reliability', s.reliability_score,
              'speed', s.speed_score,
              'performance', s.performance_score,
              'costEfficiency', s.cost_efficiency_score,
              'overallValue', s.overall_value_score,
              'confidence', s.confidence,
              'qualitySamples', s.quality_sample_count,
              'runtimeSamples', s.runtime_sample_count,
              'latencySamples', s.latency_sample_count,
              'benchmarkCoverage', s.benchmark_coverage,
              'representativeCostUsd', s.representative_cost_usd,
              'calculatedAt', s.calculated_at
            )
            order by s.task_type
          )
          from public.ai_model_task_scores s
          where s.registry_route_id = r.id
            and s.score_version = p_score_version
        ),
        '{}'::jsonb
      ),
      score_version = p_score_version,
      score_updated_at = now()
  where r.status = 'active';
end;
$$;

revoke all on function public.refresh_ai_model_registry_score_summaries(text) from public;
revoke all on function public.refresh_ai_model_registry_score_summaries(text) from anon;
revoke all on function public.refresh_ai_model_registry_score_summaries(text) from authenticated;
grant execute on function public.refresh_ai_model_registry_score_summaries(text) to service_role;
