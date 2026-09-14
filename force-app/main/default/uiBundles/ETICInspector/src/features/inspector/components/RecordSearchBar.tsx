import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { isSalesforceId, isValidIdChecksum } from "../../../lib/salesforce";
import { Spinner } from "../../../components/ui/spinner";
import { searchInputClass } from "../../../components/inputStyles";

interface RecordSearchBarProps {
  loading?: boolean;
  onSubmit: (query: string) => void;
  /** Optional initial value (e.g. the current record Id on Show all data). */
  initialValue?: string;
  placeholder?: string;
  /**
   * Auto-run the query when a valid record Id is pasted (no Enter needed).
   * Defaults to true. A pasted value only auto-runs if it's a well-formed Id
   * AND passes the 18-char checksum, so typos won't fire a bad query.
   */
  autoRunOnPaste?: boolean;
}

/**
 * Single input that accepts a record Id or an object name.
 * Submitting (Enter, the icon, or pasting a valid Id) hands the value up.
 */
export function RecordSearchBar({
  loading,
  onSubmit,
  initialValue = "",
  placeholder = "Record id or object name…",
  autoRunOnPaste = true,
}: RecordSearchBarProps) {
  const [value, setValue] = useState(initialValue);

  // Keep in sync if the parent changes the initial value (e.g. new record).
  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  const submit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    onSubmit(value);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    if (!autoRunOnPaste) return;
    const pasted = e.clipboardData.getData("text").trim();
    // Only auto-run for a clean, checksum-valid record Id.
    if (pasted && isSalesforceId(pasted) && isValidIdChecksum(pasted)) {
      e.preventDefault(); // take control of the input value ourselves
      setValue(pasted);
      onSubmit(pasted);
    }
    // Otherwise let the paste happen normally; user can press Enter.
  };

  return (
    <form onSubmit={submit} className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onPaste={handlePaste}
        spellCheck={false}
        autoComplete="off"
        placeholder={placeholder}
        className={`${searchInputClass("lg")} w-full`}
      />
      <button
        type="submit"
        disabled={loading}
        aria-label="Inspect"
        className="text-muted-foreground hover:text-foreground absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-2 disabled:cursor-not-allowed"
      >
        {loading ? <Spinner /> : <Search className="h-4 w-4" />}
      </button>
    </form>
  );
}
