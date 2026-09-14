import { Search } from "lucide-react";
import { useState } from "react";
import { Spinner } from "../../../components/ui/spinner";
import { searchInputClass } from "../../../components/inputStyles";

interface UserSearchBarProps {
  loading?: boolean;
  onSubmit: (term: string) => void;
  placeholder?: string;
}

/**
 * Username / email / alias / name search.
 *
 * Submit-only by design: it fires on Enter or the button, never per keystroke.
 * Each search costs one API call against the org's daily limit, so typing and
 * correcting a name must not bill four times.
 */
export function UserSearchBar({
  loading,
  onSubmit,
  placeholder = "Username, email, alias or name of user…",
}: UserSearchBarProps) {
  const [value, setValue] = useState("");

  const submit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    onSubmit(value);
  };

  return (
    <form onSubmit={submit} className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        spellCheck={false}
        autoComplete="off"
        placeholder={placeholder}
        aria-label="Search users"
        className={`${searchInputClass("lg")} w-full`}
      />
      <button
        type="submit"
        disabled={loading}
        aria-label="Search"
        className="text-muted-foreground hover:text-foreground absolute right-1.5 top-1/2 -translate-y-1/2 cursor-pointer rounded-md p-2 disabled:cursor-not-allowed"
      >
        {loading ? <Spinner /> : <Search className="h-4 w-4" />}
      </button>
    </form>
  );
}
