import path from 'path';
import fs from 'fs/promises';
import { ensureAuggieUpToDate, executeCustomPrompt, checkAuthentication } from '../auggie-integration.js';
import { getProjectDir, ensureProjectDirs, extractCleanMarkdown } from '../project.js';
import { buildReviewPrompt } from '../prompts/prompt.review.js';

export function registerReviewCommand(program, { startCliSpinner }) {
  program
    .command('review')
    .description('Run three Auggie reviews and save to ./.qlood/results/review-<datetime>/<category>/review.md')
    .option('-t, --timeout <ms>', 'Timeout per Auggie call in ms', (v) => parseInt(v, 10))
    .action(async (cmdOpts) => {
      const cwd = process.cwd();
      ensureProjectDirs(cwd);

      const preSpinner = startCliSpinner('Ensuring Auggie is installed and up-to-date...');
      try {
        const status = await ensureAuggieUpToDate();
        if (!status.success) {
          preSpinner.stop(`Auggie check/update failed: ${status.message}`, false);
          process.exit(1);
        }
        preSpinner.stop(status.message, true);
      } catch (e) {
        preSpinner.stop(`Error while ensuring Auggie: ${e.message}`, false);
        process.exit(1);
      }

      const authSpinner = startCliSpinner('Verifying Auggie authentication...');
      try {
        const auth = await checkAuthentication();
        if (!auth.success) {
          authSpinner.stop(`Failed to verify Auggie authentication: ${auth.error || 'Unknown error'}`, false);
          process.exit(1);
        }
        if (!auth.authenticated) {
          authSpinner.stop('You are not authenticated with Auggie. Run: auggie --login', false);
          console.log('Tip: You can authenticate by running "auggie --login" once, then re-run this command.');
          process.exit(1);
        }
        authSpinner.stop('Auggie authentication verified', true);
      } catch (e) {
        authSpinner.stop(`Error verifying Auggie authentication: ${e.message}`, false);
        process.exit(1);
      }

      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const baseDir = path.join(getProjectDir(cwd), 'results', `review-${ts}`);
      await fs.mkdir(baseDir, { recursive: true });

      const categories = [
        {
          key: 'repository-supply-chain',
          title: 'Repository & Supply Chain',
          checklist: `
- No secrets committed – .env*, keys, certs, DB dumps absent; add to .gitignore. Check history too.
- Secret patterns scan – Search for API keys/tokens (e.g., sk-, AKIA, -----BEGIN), rotate if found.
- Lockfiles present & pinned – package-lock.json/yarn.lock/pnpm-lock.yaml committed; no latest/range versions for prod deps.
- Suspicious deps – Typosquats/new maintainers/unusual postinstall scripts in package.json.
- Private registry tokens – No auth tokens in .npmrc, .yarnrc*, .piprc, .gemrc, etc.
- Binary/config leaks – No IDE caches, .DS_Store, .vscode/settings.json with creds, or compiled secrets.
- Source map policy – Public artifacts don’t include .map files or inline source maps unless intentionally gated.
- License compliance – Third-party licenses tracked; no GPL/unknown licenses bundled if not allowed.
- Git exposure guards – No /.git, .env, Dockerfile, or build scripts copied into public artifacts.
- Example env file – env.example exists with placeholders (no real values).
- Security linting config – semgrep, eslint-plugin-security, or equivalent present and enforced in CI.
- Dependabot/Snyk config – Automated PRs/scans configured in repo (configuration files present).
- Git hooks – Optional: Husky/pre-commit to block secrets/console logs; verify hook scripts in repo.`
        },
        {
          key: 'application-code-config',
          title: 'Application Code & Configuration',
          checklist: `
- Client key exposure – No secrets in client bundles; only public env vars exposed (e.g., NEXT_PUBLIC_*/Vite import.meta.env.* allowlist).
- Debug code removed – No console.log/warn/error, debug tool inits, or test routes in production builds.
- CSP & headers set in code – Helmet/middleware/config sets CSP, HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, frame-ancestors.
- CORS rules – No origin: * with credentials: true; explicit allowlist in server code.
- Cookie security – Cookies set with HttpOnly, Secure, SameSite in server code; no tokens in localStorage.
- Auth token handling – JWTs verified (issuer/audience/exp); no none alg; refresh tokens scoped & rotating.
- Authorization checks – Protected handlers verify ownership/role on every resource (avoid IDOR).
- Input validation – Centralized schema validation (e.g., Zod/Joi) for all API inputs; no string concatenation in queries.
- Output encoding – Templating escapes by default; APIs don’t reflect unsanitized user input.
- XSS sinks audited – No unsanitized dangerouslySetInnerHTML/innerHTML/jQuery .html()/Svelte {@html}; sanitize or remove.
- SSR/SSG data leaks – Server-only secrets never referenced in client paths; no private data in static pages.
- Open redirect checks – Redirects validate/allowlist returnUrl/redirect params before res.redirect.
- CSRF mitigation present – CSRF middleware/tokens on state-changing routes when using cookies.
- Rate limiting present – Per-IP/user/key throttling on auth & expensive endpoints.
- Webhook verification – HMAC/timestamp checks implemented; replay window enforced.
- SSRF protection – Server fetch of user-provided URLs validated/allowlisted; blocks internal IP ranges.
- File upload safety – Size/type limits, MIME sniff, random filenames, image transcoding; no direct write to exec paths.
- Path traversal guards – User input never concatenated into filesystem paths; use fixed roots/allowlists.
- Error handling – Client responses generic; server logs stack traces; no err.stack returned.
- Crypto choices – Passwords via bcrypt/argon2; no MD5/SHA1; strong random IVs/nonces; keys not hardcoded.
- Regex safety – Avoid catastrophic backtracking; use timeouts/safe-regex where needed.
- GraphQL hardening – Introspection off/gated in prod; depth/complexity limits; resolvers enforce auth/ownership.
- Framework configs – e.g., Next.js poweredByHeader: false; only intended envs exposed.`
        },
        {
          key: 'build-ci-iac',
          title: 'Build / CI/CD / Infrastructure-as-Code',
          checklist: `
- CI secrets handling – No echo $SECRET in logs; secrets only passed to trusted steps; masked in logs.
- Pinned actions & images – GitHub Actions use version SHAs/tags (not @main/latest); Docker base images pinned.
- Workflow safety – No unsafe pull_request_target on untrusted paths; least privileges on tokens (permissions: block).
- Artifact hygiene – CI artifacts don’t include .env, source maps (unless intentional), private keys, or DB dumps.
- SAST/dep scans in CI – Pipelines include semgrep/eslint-security and dependency scans; config files checked in.
- Dockerfile security – Non-root USER, minimal base, .dockerignore excludes secrets, no secrets in ENV/ARG, multi-stage build.
- K8s manifests – No :latest tags, runAsNonRoot: true, readOnlyRootFilesystem: true, allowPrivilegeEscalation: false, limits set.
- Cloud/IaC encryption – DB/storage resources have encryption flags on; no public buckets unless required.
- Network IaC – Security groups/firewalls don’t allow 0.0.0.0/0 to admin/DB ports; ingress rules documented.
- Infra secrets – Terraform variables/Helm values don’t embed secrets; reference secret manager instead.
- Build config – Minification/tree-shaking enabled; source maps not uploaded publicly; console stripping configured.
- SW/Cache rules – Service worker caches versioned; no caching of authenticated API responses.`
        }
      ];

      const spinner = startCliSpinner('Running Auggie reviews (3 in parallel)...');

      try {
        const tasks = categories.map(async (cat) => {
          const catDir = path.join(baseDir, cat.key);
          await fs.mkdir(catDir, { recursive: true });
          const prompt = buildReviewPrompt(cat.title, cat.checklist);
          const result = await executeCustomPrompt(prompt, { cwd, usePrintFormat: true, timeout: cmdOpts.timeout ?? undefined });
          let content = result.success ? extractCleanMarkdown(result.stdout) : `# ${cat.title} Review\n\n❌ Failed to run analysis.\n\nError:\n\n${(result.stderr || 'Unknown error')}`;
          if (!content || content.trim().length < 20) {
            content = result.stdout || content || '';
          }
          const outPath = path.join(catDir, 'review.md');
          await fs.writeFile(outPath, content, 'utf-8');
          return { title: cat.title, outPath, success: result.success };
        });

        const results = await Promise.all(tasks);
        spinner.stop('Reviews completed', true);
        console.log('\nSaved reviews:');
        for (const r of results) {
          console.log(`- ${r.title}: ${path.relative(cwd, r.outPath)}`);
        }
        const allOk = results.every(r => r.success);
        process.exit(allOk ? 0 : 1);
      } catch (error) {
        spinner.stop(`Error during reviews: ${error.message}`, false);
        process.exit(1);
      }
    });
}

