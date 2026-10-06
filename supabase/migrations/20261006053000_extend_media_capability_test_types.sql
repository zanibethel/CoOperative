alter table public.media_model_capability_tests
  drop constraint if exists media_model_capability_tests_test_type_check;

alter table public.media_model_capability_tests
  add constraint media_model_capability_tests_test_type_check
  check (
    test_type = any (
      array[
        'sfw_smoke'::text,
        'adult_content'::text,
        'reference_fidelity'::text,
        'identity_preservation'::text,
        'edit_strength'::text,
        'policy_behavior'::text,
        'control_compatibility'::text,
        'other'::text
      ]
    )
  );
