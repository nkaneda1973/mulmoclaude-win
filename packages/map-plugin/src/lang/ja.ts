interface NamedFn {
  named: (key: string) => unknown;
}

export default {
  title: "マップ",
  loading: "読み込み中…",
  configurePrompt: "Google Maps API キーを設定すると地図が有効になります。",
  configureHint: "設定 → マップ から Maps JavaScript API キーを貼り付けてください。キーはこのワークスペース内にローカル保存されます。",
  emptyHint: "地図上を右クリックでお気に入りとして保存できます。",
  favoritesCount: ({ named }: NamedFn) => `お気に入り ${String(named("count"))} 件`,
  allTagsChip: "すべて",
  closeDetail: "閉じる",
  removeFavorite: "削除",
  addPromptName: "この場所の名前を入力",
  addPromptTags: "タグ（カンマ区切り、任意）",
  previewSaved: ({ named }: NamedFn) => `${String(named("name"))} を保存しました`,
};
