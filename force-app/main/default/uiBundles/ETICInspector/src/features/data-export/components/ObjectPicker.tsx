import { Check, RefreshCw, Search } from "lucide-react";
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  COMBO_INPUT_CLASS,
  COMBO_LIST_CLASS,
  ComboOption,
} from "./comboOption";
import { Spinner } from "../../../components/ui/spinner";
import { TextButton } from "../../../components/TextButton";
import { sectionLabelSpaced } from "../../../components/sectionLabel";
import { useQueryableObjects } from "../../../hooks/useQueryableObjects";
import { useSlowHint } from "../../../hooks/useSlowHint";
import { useSessionState } from "../../../lib/sessionState";
import {
  countSystemMatches,
  nearestObjectName,
  rankObjectMatches,
} from "../../../lib/objectSearch";

interface ObjectPickerProps {
  value: string;
  loading: boolean;
  /** Resolved label once the object is confirmed to exist. */
  resolvedLabel: string | null;
  error: string | null;
  onSubmit: (objectApiName: string) => void;
}

/**
 * Cap on rendered rows, same doctrine as `FieldPicker`'s.
 *
 * A one-letter search against a 919-object org matches hundreds of names, and
 * mounting all of them on every keystroke is the measured cause of a laggy box.
 * Unlike the field picker there is nothing to rescue from the cap — no row here
 * can be "selected" and hidden — so a plain slice is safe, with a count of what
 * was left off so the user knows to narrow rather than assuming a match doesn't
 * exist.
 */
const MAX_VISIBLE = 100;

/**
 * Object entry: search the org's real object list, or type any API name.
 *
 * ## What changed and why
 *
 * This box used to be free-typed against a hard-coded list of 30 standard
 * object names, because UI API has no "list all objects" route. It produced the
 * feedback that prompted this rewrite: people searching for objects they could
 * see in Setup, and getting an error.
 *
 * There were two causes, and the list fixes both at once. `object-info` has no
 * "not found" response — **every** name it can't resolve comes back as 403
 * `INSUFFICIENT_ACCESS`, the same answer it gives for an object that really is
 * hidden — so a plural, a typo, or a custom object typed without `__c` all read
 * as "ask your admin for permission". And the suggestions themselves could
 * fail: three of the thirty (`Quote`, `QuoteLineItem`, `AccountContactRelation`)
 * 403'd in a test org where those features are switched off.
 *
 * `useQueryableObjects` fetches the set of objects the org will actually serve
 * this user, so **no name offered here can fail** — it is filtered by the org,
 * not by us, and it includes custom and managed-package objects that no static
 * list could contain. See `api/objectList.ts` for how, and what it costs.
 *
 * ## What stayed
 *
 * Free typing. The list needs one GraphQL call and introspection is one more
 * thing that can be switched off, so the box still submits whatever is typed
 * and the built-in names remain as a fallback. That path is also why the error
 * copy below still matters: it is what a typed name that isn't in the list hits.
 */
export function ObjectPicker({
  value,
  loading,
  resolvedLabel,
  error,
  onSubmit,
}: ObjectPickerProps) {
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  /** -1 means "no suggestion selected", so Enter submits exactly what was typed. */
  const [highlight, setHighlight] = useState(-1);
  /**
   * The last thing submitted, kept so a failed lookup can keep it on screen.
   *
   * Without this the box fell back to `value` — the last object that *loaded* —
   * the moment a submit ended the typing state. Typing `Quotez` over a loaded
   * Account and pressing Enter snapped the box back to "Account" while showing
   * a red error naming "Quotez": it read as though nothing had happened, or as
   * though Account itself had broken.
   */
  const [attempted, setAttempted] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * Survives navigation between tabs, like every other builder preference. Off
   * by default: measured on a real org, 208 of 919 queryable objects were
   * `*History`, so leaving them in puts a 23% wall of generated names in front
   * of every search.
   */
  const [showSystem, setShowSystem] = useSessionState<boolean>(
    "object-picker:show-system",
    false,
  );

  const {
    entries,
    loading: listLoading,
    source,
    ensure,
    refresh,
  } = useQueryableObjects();

  /**
   * The directory call is 10–20 seconds on a large org, and `useWarmObjectList`
   * only hides that for a user who spent a few seconds elsewhere first. Someone
   * who deep-links straight here still waits, in front of a spinner that says
   * nothing about how long.
   */
  const listSlow = useSlowHint(listLoading);

  const query = draft.trim();

  const matches = useMemo(
    () => rankObjectMatches(entries, query, { includeSystem: showSystem }),
    [entries, query, showSystem],
  );
  const hiddenSystemCount = useMemo(
    () => (showSystem ? 0 : countSystemMatches(entries, query)),
    [entries, query, showSystem],
  );

  const visible = matches.slice(0, MAX_VISIBLE);
  /**
   * Open on any non-empty search, including one that matches nothing.
   *
   * It used to require a match, so typing a name the org doesn't have produced
   * *silence* — indistinguishable from a list that hadn't loaded, and the user
   * only learned anything by pressing Enter and paying for a failed lookup.
   * Now that the list is the org's own, "nothing matches this" is real
   * information and worth saying before the call is made.
   */
  const open = typing && query !== "";

  /**
   * A near-miss for something that didn't resolve.
   *
   * Only computed once a lookup has actually failed — running an edit-distance
   * pass over the whole list per keystroke would be work for an answer nobody
   * asked for, and while the dropdown is open the real matches are better than
   * any guess.
   */
  const didYouMean = useMemo(
    () => (error && attempted ? nearestObjectName(entries, attempted) : null),
    [error, attempted, entries],
  );

  const close = useCallback(() => {
    setTyping(false);
    setHighlight(-1);
  }, []);

  const submit = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      setDraft(trimmed);
      setAttempted(trimmed);
      close();
      inputRef.current?.blur();
      // Picking a suggestion loads it outright — needing Enter afterwards made
      // the click feel like it hadn't registered.
      onSubmit(trimmed);
    },
    [close, onSubmit],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      setHighlight((h) => {
        const next = h + (event.key === "ArrowDown" ? 1 : -1);
        // Wrapping past either end returns to the typed text.
        if (next < -1) return visible.length - 1;
        if (next >= visible.length) return -1;
        return next;
      });
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      submit(open && highlight >= 0 ? visible[highlight].apiName : draft);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };

  /**
   * What the box shows: the draft while typing, then the attempted name if it
   * failed, and the loaded object otherwise.
   */
  const shown = typing
    ? draft
    : error && attempted
      ? attempted
      : value || draft;

  return (
    <div>
      <label htmlFor="object-input" className={sectionLabelSpaced}>
        Object
      </label>

      <div
        className="relative"
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null))
            close();
        }}
      >
        <input
          id="object-input"
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-label="Search objects by name or API name"
          autoComplete="off"
          spellCheck={false}
          value={shown}
          placeholder="Search objects — account, line item, invoice…"
          // The list is fetched here rather than on mount so a session that
          // never opens this box is never billed for it.
          onFocus={ensure}
          onChange={(e) => {
            setDraft(e.target.value);
            setTyping(true);
            setHighlight(-1);
          }}
          onKeyDown={onKeyDown}
          className={`${COMBO_INPUT_CLASS} py-2 pl-3 pr-10 text-sm shadow-sm`}
        />
        <button
          type="button"
          onClick={() => submit(typing ? draft : value || draft)}
          disabled={loading || !(typing ? draft : value || draft).trim()}
          aria-label="Load object fields"
          className="text-muted-foreground hover:text-foreground absolute right-1.5 top-1/2 -translate-y-1/2 cursor-pointer rounded-md p-1.5 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? <Spinner /> : <Search className="h-4 w-4" />}
        </button>

        {open && (
          <div className={COMBO_LIST_CLASS}>
            {listLoading && visible.length === 0 ? (
              <div className="text-muted-foreground px-2.5 py-2 text-xs">
                <p className="flex items-center gap-2">
                  <Spinner />
                  Loading this org&rsquo;s objects…
                </p>
                {/*
                  Held back for the first seconds: on a small org the list
                  arrives before this would be true, and promising a wait that
                  doesn't happen is its own kind of wrong.
                */}
                {listSlow && (
                  <p className="mt-1.5">
                    Large orgs can take up to 20 seconds. You can press Enter to
                    submit{" "}
                    <span className="text-foreground font-mono">{query}</span>{" "}
                    as an API name without waiting.
                  </p>
                )}
              </div>
            ) : visible.length === 0 ? (
              // Free typing still works, so this says what pressing Enter will
              // do rather than blocking. It is a warning, not a refusal: the
              // list can be the fallback, and an org can hold an object that
              // introspection didn't return.
              <p className="text-muted-foreground px-2.5 py-2 text-xs">
                No object matches{" "}
                <span className="text-foreground font-mono">{query}</span>.
                Press Enter to try it as an API name anyway.
              </p>
            ) : (
              <ul>
                {visible.map((entry, index) => (
                  <li key={entry.apiName}>
                    <ComboOption
                      label={entry.apiName}
                      // The readable form, plus the namespace prefix that makes
                      // a package object impossible to guess at.
                      sub={
                        entry.namespace
                          ? `${entry.label ?? entry.humanized} · ${entry.namespace} package`
                          : (entry.label ?? entry.humanized)
                      }
                      active={highlight === index}
                      chosen={value === entry.apiName}
                      onPick={() => submit(entry.apiName)}
                    />
                  </li>
                ))}
              </ul>
            )}

            {/*
              Footer facts, each of which exists because its absence was a way
              to be wrong: a cap that silently truncates looks like "no such
              object", and hidden system objects look like a missing one too.
            */}
            {(matches.length > MAX_VISIBLE ||
              hiddenSystemCount > 0 ||
              source === "fallback") && (
              <div className="border-border text-muted-foreground space-y-1 border-t px-2.5 py-1.5 text-[11px]">
                {matches.length > MAX_VISIBLE && (
                  <p>
                    Showing {MAX_VISIBLE} of {matches.length} matches — keep
                    typing to narrow.
                  </p>
                )}
                {hiddenSystemCount > 0 && (
                  <p>
                    {hiddenSystemCount} history/share/feed{" "}
                    {hiddenSystemCount === 1 ? "object" : "objects"} hidden.{" "}
                    <TextButton
                      onClick={() => setShowSystem(true)}
                      // Mousedown would blur the input and close the list
                      // before the click could land.
                      onMouseDown={(e) => e.preventDefault()}
                    >
                      Show them
                    </TextButton>
                  </p>
                )}
                {source === "fallback" && (
                  <p>
                    Couldn&rsquo;t list this org&rsquo;s objects — these are the
                    common standard ones. Any API name can still be typed.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {showSystem && (
        <p className="text-muted-foreground mt-1.5 text-[11px]">
          Including history, share and feed objects.{" "}
          <TextButton onClick={() => setShowSystem(false)}>Hide</TextButton>
        </p>
      )}

      {resolvedLabel && !error && (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-success">
          <Check className="h-3.5 w-3.5" />
          {resolvedLabel}
        </p>
      )}
      {error && (
        <div className="mt-1.5 space-y-1 text-xs">
          <p className="text-destructive">{error}</p>
          {didYouMean && (
            <p className="text-muted-foreground">
              Did you mean{" "}
              <TextButton onClick={() => submit(didYouMean)}>
                {didYouMean}
              </TextButton>
              ?
            </p>
          )}
          {/*
            Offered only on a failure, and only when the list is what would be
            stale: a just-deployed object is the one case where the org's answer
            and the cached list genuinely disagree.
          */}
          {source === "org" && (
            <p className="text-muted-foreground">
              Just deployed it?{" "}
              <TextButton onClick={refresh}>
                <RefreshCw className="mr-1 inline h-3 w-3" />
                Refresh the object list
              </TextButton>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
