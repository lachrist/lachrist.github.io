---
permalink: /repo.html
layout: page
title: Repositories
---

The following is a curated list of my personal repositories.

## Dynamic Program Analysis

Most of my work focuses on dynamic program analysis, and secpicifically on JavaScript. I have developed a number of tools to help me in this endeavor.

- [aran](https://github.com/lachrist/aran): My flagship project, a JavaScript code instrumenter that serves as an infrastructure for building advanced dynamic program analyses such as taint analysis and concolic testing. Aran conducts sophisticated code transformations to desugar many JavaScript constructs. For instance, classes are represented as functions, which alleviates the need for the analysis to reason about them. 
- [linvail](https://github.com/lachrist/linvail): A library built on top of Aran that is capable of tracking primitive values across the object graph while supporting partial instrumentation. This was made possible by implementing an access control system using the existing reflection API of JavaScript.
- [otiluke](https://github.com/lachrist/otiluke): A toolbox for deploying JavaScript code transformers, which are themselves written in JavaScript, on both Node.js and browsers. Node deployment is straightforward via the hook API, while browser deployment is more complex and involves performing a man-in-the-middle attack to intercept and transform the code before it is executed by the browser.

<!-- - [virtual-proxy](https://github.com/lachrist/virtual-proxy) -->

## Program Interpretation

I'm a big fan of the [SICP book](https://web.mit.edu/6.001/6.037/sicp.pdf) which introduced my the concept of metacircular interpreters. I have developed a number of interpreters for various languages.

- [cesk-labo](https://github.com/lachrist/cesk-labo): Experiment to 

## VSCode Extensions

I'm knowledgeable in the development of Visual Studio Code extensions. I have created several extensions to assist me in my daily work.

- [latex-assistant](https://github.com/lachrist/vscode-latex-assistant): An assistant for writing LaTeX in Visual Studio Code to help me with my forever ongoing PhD thesis.
- [listing-theme](https://github.com/lachrist/vscode-listing): A tool to extract syntax highlighting as it appears in VSCode. This was born from my frustration with achieving the same highlighting quality of VSCode in LaTeX using existing highlighters such as minted and listings.

## Coaching

I'm a swimming coach for the [NSG](https://www.sport.brussels/clubs/la-nage-saint-gilles/) swimming club in Brussels. I have developed a number of tools to help me in this endeavor.

- [tictac](https://github.com/lachrist/tictac): A chronometer to time my swimmers in various format: internal, split, broken. This helped me provide high quality feedback during my training sessions and helped me export the results in spreadsheets.
- [forgiving-splits](https://github.com/lachrist/forgiving-splits): Another chronometer to count my swimmers laps during long distance swims. During such swims, it is easy to miss a lap, which amper the results. This tool solved the problem by detecting time discrepancies in lap splits.
- [abi-dalzim](https://github.com/lachrist/abi-dalzim): A training generator for dry land sessions. This tool helped me design and share training programs for at home session, it became very useful during the COVID-19 pandemic.

## Miscellaneous
