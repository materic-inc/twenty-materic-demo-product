#!/usr/bin/env bash
set -euo pipefail

base_branch=codex/demo-product
update_branch=automation/upstream-main
upstream_url=https://github.com/twentyhq/twenty.git

git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
git fetch "$upstream_url" main --no-tags
upstream_sha=$(git rev-parse FETCH_HEAD)
if git merge-base --is-ancestor "$upstream_sha" HEAD; then
  echo 'Demo already includes upstream main.'
  exit 0
fi

git checkout -B "$update_branch"
if ! git merge --no-edit "$upstream_sha"; then
  git merge --abort
  echo '::error::Upstream conflicts with demo changes. Merge upstream/main locally, review migrations, and open a PR. Demo deployment is unchanged.'
  exit 1
fi
git push --force-with-lease origin "HEAD:refs/heads/$update_branch"
body_file=$(mktemp)
trap 'rm -f "$body_file"' EXIT
cat > "$body_file" <<BODY
Merge Twenty upstream main at $upstream_sha into the demo deployment branch.

The deployment remains unchanged until this PR is reviewed and merged. Check schema migration requirements and take a database snapshot before merging. This workflow never resets or reseeds the database. A successful build alone does not prove a database upgrade is safe.

The build workflow is dispatched explicitly because PRs created with GITHUB_TOKEN do not trigger pull_request workflows. Any merge conflicts stop this workflow and require a reviewed local resolution.
BODY
existing_pr=$(gh pr list --head "$update_branch" --base "$base_branch" --state open --json number --jq '.[0].number // empty')
if [[ -n "$existing_pr" ]]; then
  gh pr edit "$existing_pr" --body-file "$body_file"
else
  gh pr create --head "$update_branch" --base "$base_branch" --title 'chore: bring current Twenty upstream into demo' --body-file "$body_file"
fi
gh workflow run demo-ci.yml --ref "$update_branch"
