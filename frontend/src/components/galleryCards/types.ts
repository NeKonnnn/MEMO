/** Общие типы карточек галереи (агенты / skills). */

export type GalleryCardItem = {
  id: number;
  title: string;
  authorName: string;
  preview: string;
  metaLine?: string;
  viewsCount?: number;
  usageCount?: number;
  averageRating?: number;
  totalVotes?: number;
  userRating?: number | null;
  isBookmarked?: boolean;
};
