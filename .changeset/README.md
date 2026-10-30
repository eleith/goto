# Changesets

Run `pnpm changeset` to record an application change for `@goto/web`.

`pnpm version:apps` consumes pending changesets and updates versions/changelogs.
`pnpm tag:apps` creates the corresponding Git tags. Run release operations only
when authorized. After checks pass, CI publishes `latest` from main and versioned
images from stable application tags that match the package version.
