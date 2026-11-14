# AI plan

> **Plan. There is no code yet.** This document fixes what the **AI** tab and the **AI** menu will do, which services they use, and the rules for accuracy, privacy and cost. The AI menu is the same list of commands in the classic menu bar; anything said here about the tab applies to the menu. Command ids are in [COMMANDS-PLAN.md](COMMANDS-PLAN.md#ai).

The AI tab is optional. Anne's Witness is complete without it, and nothing is sent anywhere until you run an AI command. Every AI command is an ordinary command: it can go on the Quick Access Bar, on a custom tab, in the menu bar, on a shortcut or in a macro.

## The rule: the AI may point; only an anchor proves

This app exists to answer "how do you know?". A language model is fluent and can be confidently wrong, including about what a document says. An evidence tool that let a model's word count as evidence would defeat its own purpose. So:

1. **AI output is never evidence.** A summary, a translation, a transcription or an answer written by a model cannot be tied to a claim as support. Only an anchor in a source can. AI transcriptions and translations are kept beside the original and labeled; the picture or the original text stays the evidence.
2. **Every proposal passes the verification gate.** When a model proposes that a passage supports or contradicts a claim, it must return the source, the location and the passage's exact words. The app itself, with ordinary string and number matching and no model, then checks that those words are at that location in that source. A proposal that fails is discarded and counted in AI History; it is never shown as a tie.
3. **A person confirms.** Proposals that pass the gate appear as *proposed ties*, drawn differently from confirmed ones. They do not change a claim's status. *Confirm Proposed Tie* (`tie.confirm`) records who confirmed it and that it began as an AI proposal. *Confirm All in Selection* asks once and states the count.
4. **AI does not set status and does not settle disputes.** Supported, Corroborated and Settled come only from confirmed ties and a person's written conclusion. *Draft Conclusion* writes a first wording from the Reckoning table the person filled in; it does not choose the preferred source.
5. **Answers come from the case.** *Ask the Case* answers only from passages in the case's sources. Each sentence of the answer carries its anchors, each anchor has passed the gate, and a sentence with no anchor is not shown. "The sources in this case do not say" is a normal, expected answer.
6. **Opinions are labeled as opinions.** *Explain This Source*, *Explain Disagreement* and *Suggest Where to Look* draw on a model's general knowledge. Their output is marked as such, goes to notes or to-dos, and cannot be tied.

## What the AI tab does

| Group | Commands | What is sent (default) |
|---|---|---|
| **Ask** | Ask the Case, Explain This Source, Explain Disagreement | the question and the passages the on-device search selected; for Explain, the source's details and the anchored passages |
| **Find** | Extract Claims from Document, Find Support for Claim, Find Contradictions, Suggest Where to Look, Check That Citations Exist | the document text (Extract); the claim and candidate passages chosen on the device (Find Support, Find Contradictions); the claim and the list of source titles (Suggest); the citation list (Check) |
| **Read** | Transcribe Source, Translate Passage, Extract Fields from Record, Summarize Source, Describe Picture | the page image or passage you chose |
| **Check** | Check Paraphrase, Suggest Tie Kind, Assess Independence, Screen for Private Information | the claim and its tied passage; for Independence, the passages of the two sources; Screen for Private Information runs on the device only and sends nothing |
| **Write** | Draft Proof Summary, Draft Citation, Draft Conclusion, Draft Research Plan, Run on Selection | claims, confirmed ties and conclusions; for Draft Citation, the title page or heading |
| **Providers** | Set Up AI, Providers and Models, Active AI, AI and Privacy, Several AIs, Choose AIs, Show AI Discussion, AI History, Stop AI, Delete Downloaded Models | nothing |

### Find Support for Claim in detail

1. On the device, the claim is compared with every passage of the case's sources (embeddings plus exact matching of numbers, dates and names) and the best candidates are chosen. Confidential sources are skipped.
2. The claim and those candidate passages, each with its source and location, go to the text model with instructions to return, as structured output, the passages that support the claim, the exact words relied on, and whether the support is direct or indirect.
3. **The verification gate:** for each returned item, the app looks up the location and checks that the exact words are there. Numbers are compared as numbers under the case's rounding rules. Anything that does not match is dropped.
4. Survivors appear as proposed ties next to the claim, each opening the source at the passage. Nothing is tied until the person confirms.
5. If nothing survives, the pane says that no support was found in the case, and offers *Suggest Where to Look*.

### Check That Citations Exist in detail

Models sometimes invent references. This command never asks a model whether a work exists. It reads the citations in the linked document (the app's own parser first, a model only to split badly formatted ones into fields), then looks each one up: first among the case's sources, then, if the person allows it, in public catalogs by identifier or title. The result is a list in three groups: *in the case*, *found in a catalog but not in the case*, and *not found anywhere*. The last group is a list of things to check by hand, not an accusation.

### Extract Claims in detail

The app's own pattern rules (`claim.captureNumbers`, `claim.captureQuotes`, `claim.captureFacts`) run first and need no service. *Extract Claims from Document* adds the checkable statements those rules miss, each returned with its exact position in the document; a returned claim whose text is not at that position is dropped by the same gate. Proposed claims are listed for acceptance, not added silently.

## Setting up

**AI ▸ Set Up AI** is the suite's wizard. It

1. lists services grouped as *Free · on device*, *Free · your computer* (Ollama, LM Studio, llama.cpp server and other OpenAI-compatible local servers), *Free tier*, *Free trial* and *Paid*;
2. links to each service's key page and checks the key with a tiny test request;
3. fetches the service's model list where one is published, so models are chosen by name and not from a list frozen into the app;
4. shows what each command will send and, for paid services, links to the current price page.

Service terms, free tiers and model names change often; the wizard links to each service's current pages and does not promise limits or prices.

### Services (planned adapters)

The suite's shared adapters: Anthropic, OpenAI, Google Gemini, Mistral, Groq, OpenRouter, Azure OpenAI, AWS Bedrock, and any OpenAI-compatible endpoint (which covers the local servers). Structured output (JSON schema or tool calling) is required for every command that passes the verification gate; a service that cannot return it is not offered for those commands. Transcribe, Extract Fields and Describe Picture need a model that accepts images.

## On the device

Small models run in the app (ONNX Runtime Web or Transformers.js; WebGPU where available, WASM otherwise) for:

- **passage embeddings**, so candidates are chosen locally and only a few passages leave the device;
- **Screen for Private Information**, which must work with no service at all;
- an optional small text model for simple questions when no service is set up.

Each model's license is shown before download, and only permissively licensed weights are offered (see [LEGAL.md](LEGAL.md)). *Delete Downloaded Models* removes them.

## Several AIs

The text commands can use the suite's ensemble modes (one AI combines the others' answers, or the AIs deliberate until they agree), as specified for the suite in [Anne's Base's ENSEMBLE.md](https://github.com/socrtwo/annes-base/blob/main/docs/ENSEMBLE.md). In Anne's Witness, each member proposes ties separately and every proposal from every member passes the verification gate. The pane then shows, for each passage, which members proposed it. Agreement among models is shown as information; it is not corroboration, and it never changes a claim's status.

## What the app will not do

- Count a model's statement as a source, or let a summary, translation or AI transcription be tied as support.
- Show a proposed tie whose quoted words the app could not find at the named spot.
- Confirm ties, set a status, prefer a source or write a conclusion into the case without a person's action.
- Send a source marked **confidential**, or any part of it, to any service. Such sources are skipped by every AI command, including the on-device search that feeds them.
- Send a password-protected case's contents to any service unless that case's own setting allows it.
- Fill a gap. If a date, name or figure is unreadable in the source, AI transcription marks it unclear; it does not supply a likely value.
- Present a model's general knowledge as something the case's sources say.

## Privacy and keys

*AI and Privacy* (`ai.privacy`) is set per case, with **Passages only** as the default: commands send the few passages they need, never whole sources. **Whole pages** (needed for Transcribe and Extract Fields) and **Whole documents** (needed for Extract Claims) are asked for when a command needs them. Each source can also be set to *never send*.

Keys are stored in the platform keychain (Android Keystore, iOS Keychain, Windows Credential Manager, macOS Keychain, libsecret on Linux; on the web, encrypted in the browser with a passphrase), never in the case file or in exported settings. **AI History** (`ai.history`) records, per case, what was sent, to which service, what came back, and how many proposals the verification gate discarded; it can be cleared.

## Cost

Before a command that covers many claims or pages runs, the app states how many requests it will make. Paid services charge for each; with Several AIs, each member is a separate request.
