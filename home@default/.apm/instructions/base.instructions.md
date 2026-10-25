---
description: Baseline communication, commit, and review rules that apply to every project.
---

# Base

- Always respond in Japanese
- ユーザーが「mdrollで開いて」「mdrollでプレビューして」など、mdroll による表示を明示的に依頼した場合のみ `mdroll-in-herdr <file>` を実行する。Markdownを書いただけの場合や「critで開いて」と依頼された場合は実行しない
- 絵文字は使用禁止。ただしツールが emoji を必須とするパラメータ（Artifact の `favicon` 等）は対象外
- 要求された変更に先立って振る舞いを変えない構造整理が必要な場合だけ、`/tidy-first-conventions` スキルを参照する
- If you are asked to write a commit message, please write it in English.
- When creating a commit message and returning an example, please avoid using Conventional Commits and use capital letters.
- When committing, only include files the user explicitly wants committed. For multilingual docs, confirm which language version(s) to include before committing.
- レビューを依頼された時は以下の点を考慮してください
  - コードの重複を指摘するときに同じファイルに同じ処理の塊が3つ以上出てきた場合に指摘をしてください
- Obsidian（vault の読み書き、保存先、文章スタイル、vault 組織ルール）は `/obsidian-vault` スキルを参照。Obsidianへの保存はユーザーが明示的に指示した場合のみ行う
- 道具ごとの規範はスキルを参照: mairu CLI を実行するなら `/mairu`、PR description を書くなら `/pull-request-description`
- URL の取得には、実行環境で利用可能な Web 取得機能または `ax` CLI を使い、目的に合うものを選ぶ。`curl` や使い捨ての HTML 解析スクリプトは使わない。ページの探索、構造化抽出、未知の Web ページや API の調査には `/ax` スキルを使う。User-Agent を手動指定しない
- サブエージェントの起動は、ユーザーが明示的に依頼したときか、ユーザーが呼び出したスキルが手順として指示しているときに限る。モデルの判断で自動的に起動しない

## 知識・事実の確認

- 最新の仕様・価格・法律など変わり得る情報は、現在の一次情報で確認する。不確かな事実、専門性の高い話、医療・法律・お金に関わる判断は裏取りする。ユーザーが検索・検証を求めた場合は行う。安定した基礎知識、渡された文章の要約、手元のコードから判断できることは検索必須にしない。検証できない点は確認済みの事実と区別して伝える。検索回数ではなく根拠の十分さを判断し、1回検索しただけで検証が十分としない
- 検索しても自信の持てる結果に辿り着けない場合、最初に想定したジャンルへ検索語を狭めたまま再検索し続けない。まずジャンルの決め打ち自体を疑い、固有名詞そのものだけで検索する、複数ジャンルにまたがる中立的な語を使うなど、検索語を広げて調べ直す。それでも裏取りできない内容は、確定した事実として答えず不確実性を明示する。

## 医療情報の確認

- 病気・症状・治療法などの医療トピックでは、厚生労働省および関連する国内の公的機関（薬剤の承認・適応はPMDAを含む）、e-ヘルスネットの情報を優先的な情報源として重視する。国内の医療制度、診断基準、治療方針、薬剤の承認・扱いに関わる内容は、日本国内の公的情報と突き合わせる。
- NIH/PMCなどの海外医学文献は、病態生理など国際的に共通する内容の裏取りに使ってよい。ただし海外文献の記述を、日本国内の診断・治療・薬剤の運用としてそのまま扱わず、国内情報で確認できない部分は不確実性を明示する。

# Scope and YAGNI

- 明示された要求と、その要求を満たすために必要な変更だけを実装する
- 将来の利用を想定した抽象化、設定項目、拡張ポイント、互換層を追加しない
- 依頼された変更に不要な近接コードの整理やリファクタリングを行わない
- 新しい抽象化は、現在の変更で複数の具体的な利用箇所があり、既存の重複基準にも該当する場合に限る
- 要求を満たし、関連する検証が通った時点で作業を終了する
- 改善候補が現在の要求に不要なら実装せず、ユーザーの判断に必要な場合だけ報告する

## Codex CLIでの実行環境

- `bash -lc` や `zsh -lc` のようなネストしたログインシェルを使わず、`exec_command` からコマンドを直接実行する。ネストした非対話シェルではmacOSの`/usr/bin`がPATHの先頭に入り、mise管理のランタイムが隠れることがある
- Ruby、Node.jsなどmise管理のランタイムを使うコマンドは、`mise exec -- <command>` 経由で実行する
- ランタイムを使うテストやスクリプトの実行前に、`command -v <runtime>` と `<runtime> --version` で解決先とバージョンを確認する

## Herdrでの新しいエージェント起動

- 許可済みの新しいエージェントを起動するときは `/herdr-agent-launch` スキルを参照する。Herdr管理下では現在のworkspaceを使い、新しいworkspaceを作成しない。この指示は追加のエージェント起動を許可しない
