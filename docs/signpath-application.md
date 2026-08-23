# SignPath Foundation application

MenüQR Bridge intends to use the free SignPath Foundation Open Source Code
Signing programme. Approval is controlled by SignPath Foundation and is not
guaranteed by this repository.

## Repository readiness

- [x] Entire signed desktop application source is public.
- [x] All build and installer scripts are public.
- [x] Apache-2.0 is an OSI-approved license.
- [x] No proprietary binary component is bundled by the project.
- [x] Privacy, security, contribution, trademark, and code-signing policies are
  public.
- [x] CI uses GitHub-hosted runners and uploads bounded build artifacts.
- [ ] Repository members and approvers are confirmed with GitHub MFA enabled.
- [ ] First unsigned release is published and documented.
- [ ] SignPath Foundation application is submitted and approved.
- [ ] SignPath GitHub App is installed for this repository.
- [ ] Trusted Build System GitHub.com is linked to the SignPath project.
- [ ] Release signing policy enables trusted-build-system and origin
  verification.
- [ ] Dedicated CI submitter and `SIGNPATH_API_TOKEN` are configured.
- [ ] Signed installer and updater end-to-end test passes on Windows.

## Application information

- Project: MenüQR Bridge
- Repository: `https://github.com/Trillianti/menueqr-bridge`
- License: Apache-2.0
- Platform: Windows 10/11 x64
- Artifact: NSIS installer for the open-source Electron desktop bridge
- Build system: GitHub Actions, GitHub-hosted `windows-latest` runner
- Privacy policy: `PRIVACY.md`
- Code signing policy: `CODE_SIGNING_POLICY.md`
- Security policy: `SECURITY.md`

Apply through the SignPath Foundation website after the first unsigned release
is visible. The project must use SignPath's GitHub trusted-build-system
connector. Its official integration requires uploading the unsigned artifact
with `actions/upload-artifact` before submitting it with
`signpath/github-action-submit-signing-request@v2`.

Do not add placeholder SignPath IDs or an API token to the release workflow.
SignPath supplies the organisation ID, project slug, signing-policy slug, and
artifact configuration during onboarding. Integrate those exact values only
after approval so the generated updater manifest is rebuilt against the final
signed bytes.
