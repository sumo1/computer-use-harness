# Step 02 - Architecture review bootstrap

## Goal

Review how the second app exposes the real boundary between generic runtime and app-specific fallback.

## Review contract

- Check CLI / runtime / usecase / native-helper / app-specific fallback / policy / trace / verifier boundaries.
- Confirm QQ Music-specific code is still quarantined and not polluting the generic path.
- Decide whether Sublime needs an app-specific adapter or can stay on the generic path.
- Check that trace evidence is strong enough to prove a real completion, not just a green exit code.
- Check that policy is evaluated before action and blocked paths stay explicit.

## Acceptance contract

- Review notes are captured in this task tree.
- Findings are classified by severity.
- Every recommendation is tied to a concrete file, boundary, or behavior.

## Review posture

- Prefer removal of special cases over adding another if branch.
- If a fallback is app-specific, name it that way.
- If a trace does not prove the real-world effect, it is not enough.
