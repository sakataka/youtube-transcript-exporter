import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription } from "@/components/ui/empty";

export type CaptionOptionView = {
  index: number;
  language: string;
  name: string;
  selected: boolean;
  source: string;
};

export type SearchResultView = {
  startLabel: string;
  text: string;
  timestampUrl: string;
};

export type HistoryEntryView = {
  id: string;
  metadata: string;
  title: string;
};

export function CaptionOptions({ options }: { options: CaptionOptionView[] }) {
  return options.map((option) => (
    <label className="caption-option" key={option.index}>
      <input type="radio" name="caption-option" value={option.index} defaultChecked={option.selected} />
      <span className="caption-option-body">
        <strong>{option.name || option.language}</strong>
        <span>{option.language} <Badge variant="secondary">{option.source}</Badge></span>
      </span>
    </label>
  ));
}

export function SearchResults({ results, openLabel }: { results: SearchResultView[]; openLabel: string }) {
  return results.map((result) => (
    <Button
      className="search-result"
      variant="ghost"
      type="button"
      key={`${result.startLabel}-${result.timestampUrl}`}
      data-timestamp-url={result.timestampUrl}
    >
      <span className="search-result-body">
        <strong>{result.startLabel}</strong>
        <span>{result.text}</span>
      </span>
      <span className="search-result-action">{openLabel}</span>
    </Button>
  ));
}

export function HistoryList({ entries, emptyLabel }: { entries: HistoryEntryView[]; emptyLabel: string }) {
  if (entries.length === 0) {
    return (
      <Empty className="history-empty">
        <EmptyDescription>{emptyLabel}</EmptyDescription>
      </Empty>
    );
  }

  return entries.map((entry) => (
    <Button className="history-item" variant="ghost" type="button" key={entry.id} data-history-id={entry.id}>
      <strong>{entry.title}</strong>
      <span>{entry.metadata}</span>
    </Button>
  ));
}
