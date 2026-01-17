import { LitElement } from 'lit';
export declare class YtdApp extends LitElement {
    private currentView;
    private theme;
    private url;
    private batchUrls;
    private videoDetails;
    private playlistItems;
    private selectedFormat;
    private tasks;
    private history;
    private downloadPath;
    private isAnalyzing;
    static styles: import("lit").CSSResult;
    firstUpdated(): Promise<void>;
    applyTheme(): void;
    private addDownload;
    render(): import("lit-html").TemplateResult<1>;
    private renderView;
    private viewSingle;
    private viewBatch;
    private viewDownloading;
    private viewHistory;
    private refreshHistory;
    private viewSettings;
}
