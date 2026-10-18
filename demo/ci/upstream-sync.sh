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
compare_url="https://github.com/$GH_REPO/compare/codex%2Fdemo-product...automation%2Fupstream-main?expand=1"
echo "Review upstream changes: $compare_url"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo '### Upstream review branch updated'
    echo
    echo "Twenty main: \`$upstream_sha\`"
    echo
    echo "[Review changes and create a pull request]($compare_url)"
    echo
    echo 'Organization policy prevents GitHub Actions from creating pull requests. The proposal branch is validated by CI; review and create its PR through this link. The deployment branch and database are unchanged.'
    echo
    echo 'Review schema migrations before merging. Take a database snapshot and follow Twenty upgrade requirements; a successful build does not prove a database upgrade is safe.'
  } >> "$GITHUB_STEP_SUMMARY"
fi
gh workflow run demo-ci.yml --ref "$update_branch"
