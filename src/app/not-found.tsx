import { DeadEnd } from "@/components/DeadEnd";

/**
 * Every 404 in Power Suite, and there are more of them than usual: requireApp
 * answers notFound() for anybody without an app's flag, so this is the designed
 * answer to somebody trying a route to see what happens, not an edge case.
 *
 * Until now that answer was Next's own unstyled page, which said two things
 * worth keeping quiet: that they had reached something real, and what it was
 * built with.
 */
export default function NotFound() {
  return (
    <DeadEnd
      testId="not-found"
      title="That page isn’t here"
      note="The address may be out of date, or it may never have been an address at all. Head back and start again."
    />
  );
}
