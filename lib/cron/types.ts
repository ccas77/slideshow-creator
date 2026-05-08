export interface Job {
  userId: string;
  acc: { id: number; username: string };
  win: { start: string; end: string };
  imagePrompt: string;
  imagePromptId: string;
  slideTexts: string[];
  slideshowId: string;
  captionText: string;
  captionId: string;
  source: string;
  coverImage?: string;
  schedKey: string;
  slideshowName: string;
  bookName: string;
}

export interface CronAccountResult {
  userId: string;
  accountId: number;
  username: string;
  status: string;
}

export interface TopNResult {
  userId: string;
  listName: string;
  status: string;
}

export interface IgResult {
  userId: string;
  status: string;
}
