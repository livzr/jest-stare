import { Constants } from "./Constants";
import { ISubstitute } from "./doc/ISubstitute";
import { IO } from "../utils/IO";
import * as mustache from "mustache";
import * as path from "path";
import { IJestStareConfig } from "./doc/IJestStareConfig";
import { Logger } from "../utils/Logger";
import * as chalk from "chalk";
import { IThirdPartyDependency } from "./doc/IThirdPartyDependency";
import { Dependencies } from "./Dependencies";
import { IProcessParms } from "./doc/IProcessParms";
import { Config } from "./Config";
import { ImageSnapshotDifference } from "../render/diff/ImageSnapshotDifference";
import { AggregatedResult } from "@jest/test-result";
import { isNullOrUndefined } from "../utils/helpers";

/**
 * Class to post process jest output and summarize information in an html file
 * @export
 * @class Processor
 */
export class Processor {
    /**
     * Main exported method to obtain and return summary results
     * @static
     * @param {IResultsProcessorInput} results - input results object
     * @param {IJestStareConfig} [explicitConfig] - programmatic config
     * @param {IProcessParms} [mProcessParms] - parms object to control process behavior
     * @returns - returns input results object
     * @memberof Processor
     */
    public static run(
        results: AggregatedResult,
        explicitConfig?: IJestStareConfig,
        parms?: IProcessParms
    ) {
        return new Processor(results, explicitConfig, parms).generate();
    }

    /**
     * Instance of our logger
     * @private
     * @type {Logger}
     * @memberof Processor
     */
    private mLog: Logger;

    /**
     * Creates an instance of Processor.
     * @param {IResultsProcessorInput} results - input results object
     * @param {IJestStareConfig} [explicitConfig] - programmatic config
     * @param {IProcessParms} [mProcessParms] - parms object to control process behavior
     * @memberof Processor
     */
    constructor(
        private mResults: AggregatedResult,
        private mExplicitConfig?: IJestStareConfig,
        private mProcessParms?: IProcessParms
    ) {}

    /**
     * Generate a report after constructed
     * @private
     * @returns
     * @memberof Processor
     */
    private generate() {
        const substitute: ISubstitute = {};

        // throw error if no input object
        if (isNullOrUndefined(this.mResults)) {
            throw new Error(Constants.NO_INPUT);
        }

        const config = new Config(
            this.logger,
            this.mExplicitConfig,
            this.mProcessParms
        ).buildConfig();

        // build mustache render substitution values
        substitute.results = this.mResults;
        substitute.rawResults = JSON.stringify(this.mResults, null, 2);
        substitute.jestStareConfig = config;
        substitute.rawJestStareConfig = JSON.stringify(config, null, 2);

        // save in reporter
        if (this.mProcessParms && this.mProcessParms.reporter) {
            this.mProcessParms.reporter.jestStareConfig = config;
            substitute.globalConfig = JSON.stringify(
                this.mProcessParms.reporter.mGlobalConfig,
                null,
                2
            );
        }

        // generate report
        this.generateReport(config.resultDir, substitute, this.mProcessParms);

        this.collectImageSnapshots(config.resultDir, this.mResults);

        if (config.additionalResultsProcessors != null) {
            this.execute(this.mResults, config.additionalResultsProcessors);
        }
        // return back to jest
        return this.mResults;
    }

    /**
     * Save image snapshot files to image snapshot diff dir
     * @param resultDir
     * @param parms
     */
    private collectImageSnapshots(
        resultDir: string,
        results: AggregatedResult
    ) {
        results.testResults.forEach((rootResult) => {
            if (rootResult.numFailingTests) {
                rootResult.testResults.forEach((testResult) => {
                    testResult.failureMessages.forEach((failureMessage) => {
                        if (
                            typeof failureMessage === "string" &&
                            ImageSnapshotDifference.containsDiff(failureMessage)
                        ) {
                            const diffImagePath =
                                ImageSnapshotDifference.parseDiffImagePath(
                                    failureMessage
                                );
                            const diffImageName =
                                ImageSnapshotDifference.parseDiffImageName(
                                    failureMessage
                                );

                            if (IO.existsSync(diffImagePath)) {
                                IO.mkdirsSync(
                                    resultDir +
                                        Constants.IMAGE_SNAPSHOT_DIFF_DIR
                                );

                                const reportDiffImagePath =
                                    resultDir +
                                    Constants.IMAGE_SNAPSHOT_DIFF_DIR +
                                    diffImageName;
                                IO.copyFileSync(
                                    diffImagePath,
                                    reportDiffImagePath
                                );
                            }
                        }
                    });
                });
            }
        });
    }

    /**
     * Create HTML report
     * @private
     * @param {string} resultDir -  directory to save report
     * @param {ISubstitute} substitute - substitution values for mustache render
     * @param {ISettings} settings - settings for IO
     * @memberof Processor
     */
    private generateReport(
        resultDir: string,
        substitute: ISubstitute,
        parms: IProcessParms
    ) {
        // create directory
        IO.mkdirsSync(resultDir);

        // create raw json
        IO.writeFileSync(
            resultDir + substitute.jestStareConfig.resultJson,
            substitute.rawResults
        );

        // create jest-stare config if requested
        if (substitute.jestStareConfig.jestStareConfigJson) {
            IO.writeFileSync(
                resultDir + substitute.jestStareConfig.jestStareConfigJson,
                substitute.rawJestStareConfig
            );
        }

        // create global config if requested
        if (
            substitute.globalConfig &&
            substitute.jestStareConfig.jestGlobalConfigJson
        ) {
            IO.writeFileSync(
                resultDir + substitute.jestStareConfig.jestGlobalConfigJson,
                substitute.globalConfig
            );
        }

        // exit here for JSON only retain
        if (
            substitute.jestStareConfig.report != null &&
            !substitute.jestStareConfig.report
        ) {
            return;
        }

        // create base html file
        IO.writeFileSync(
            resultDir + substitute.jestStareConfig.resultHtml,
            mustache.render(
                this.obtainWebFile(Constants.TEMPLATE_HTML),
                substitute
            )
        );

        // create our css
        const cssDir = resultDir + Constants.CSS_DIR;
        IO.mkdirsSync(cssDir);
        IO.writeFileSync(
            cssDir + Constants.JEST_STARE_CSS,
            this.obtainWebFile(Constants.JEST_STARE_CSS)
        );

        // create our js
        const jsDir = resultDir + Constants.JS_DIR;
        IO.mkdirsSync(jsDir);
        IO.writeFileSync(
            jsDir + Constants.JEST_STARE_JS,
            this.obtainJsRenderFile(Constants.JEST_STARE_JS)
        );

        // add third party dependencies
        Dependencies.THIRD_PARTY_DEPENDENCIES.forEach((dependency) => {
            // dependency.targetDir = resultDir + dependency.targetDir;
            const updatedDependency = Object.assign({}, ...[dependency]);
            updatedDependency.targetDir = resultDir + dependency.targetDir;
            this.addThirdParty(updatedDependency);
        });

        // log complete
        let type = " ";
        type +=
            parms && parms.reporter
                ? Constants.REPORTERS
                : Constants.TEST_RESULTS_PROCESSOR;
        this.logger.info(
            Constants.LOGO +
                type +
                Constants.LOG_MESSAGE +
                resultDir +
                substitute.jestStareConfig.resultHtml +
                Constants.SUFFIX
        );
    }

    /**
     * Pass the result processor input given to jest-stare to additional
     * test results processors
     * @param jestTestData - input passed to jest-stare
     * @param {IResultsProcessorInput} jestTestData - input passed to jest-stare
     * @param {string[]} processors - processors
     * @param processors - list of test results processors (e.g. ["jest-junit"])
     *                     to forward the data to
     * @memberof Processor
     */
    private execute(
        jestTestData: AggregatedResult,
        processors: string[]
    ): void {
        for (const processor of processors) {
            if (processor === Constants.NAME) {
                this.logger.error(
                    "Error: In order to avoid infinite loops, " +
                        "jest-stare cannot be listed as an additional processor. Skipping... "
                );
                continue;
            }
            try {
                require(processor)(jestTestData);
                this.logger.info(
                    Constants.LOGO +
                        " passed results to additional processor " +
                        chalk.white('"' + processor + '"') +
                        Constants.SUFFIX
                );
            } catch (e) {
                this.logger.error(
                    'Error executing additional processor: "' +
                        processor +
                        '" ' +
                        e
                );
            }
        }
    }

    /**
     * Add all third party dependencies
     * @private
     * @param {IThirdPartyDependency} dependency - a dependency to add
     * @memberof Processor
     */
    private async addThirdParty(dependency: IThirdPartyDependency) {
        const location = require.resolve(
            dependency.requireDir + dependency.file
        );
        await IO.writeFileSync(
            dependency.targetDir + dependency.file,
            IO.readFileSync(location)
        );
    }

    /**
     * Obtain web files
     * @private
     * @returns {string} - file contents from web directory
     * @memberof Processor
     */
    private obtainWebFile(name: string): string {
        return IO.readFileSync(path.resolve(__dirname + "/../../web/" + name));
    }

    /**
     * Obtain js files
     * @private
     * @returns {string} - js file contents from js directory
     * @memberof Processor
     */
    private obtainJsRenderFile(name: string): string {
        return IO.readFileSync(path.resolve(__dirname + "/../render/" + name));
    }

    /**
     * Set logger instance
     * @private
     * @memberof Processor
     */
    set logger(logger: Logger) {
        this.mLog = logger;
    }

    /**
     * Get log instance
     * @readonly
     * @private
     * @memberof Processor
     */
    get logger() {
        if (isNullOrUndefined(this.mLog)) {
            this.logger = new Logger();
        }
        // console.log((this.mLog as any).writeStdout)
        return this.mLog;
    }
}
