/*
2013, @muazkh - github.com/muaz-khan
MIT License - https://webrtc-experiment.appspot.com/licence/
Documentation - https://github.com/muaz-khan/WebRTC-Experiment/tree/master/RecordRTC
*/

(function() {
    window.RecordRTC = function(config) {
        var win = window,
            requestAnimationFrame = win.webkitRequestAnimationFrame || win.mozRequestAnimationFrame,
            cancelAnimationFrame = win.webkitCancelAnimationFrame || win.mozCancelAnimationFrame,
            URL = win.URL || win.webkitURL,
            canvas = document.createElement('canvas'),
            context = canvas.getContext('2d'),
            video = config.video,
            requestedAnimationFrame, frames = [],
            blob, dataURL, fileType,
            AudioContext = win.webkitAudioContext,
            mediaStreamSource, recorder, audioContext,
            fileSystemURL, gifEncoder;

        function recordVideo() {
            if (!video) throw 'Now video element found.';

            console.log('started recording video frames');

            video.width = canvas.width = 320;
            video.height = canvas.height = 240;

            var height = 240, width = 320;

            frames = [];

            function drawVideoFrame() {
                requestedAnimationFrame = requestAnimationFrame(drawVideoFrame);
                context.drawImage(video, 0, 0, width, height);
                frames.push(canvas.toDataURL('image/webp', 1));
            }

            requestedAnimationFrame = requestAnimationFrame(drawVideoFrame);
        }

        function stopVideoRecording(callback) {
            console.warn('stopped recording video frames');
            cancelAnimationFrame(requestedAnimationFrame);

            blob = Whammy.fromImageArray(frames, 1000 / 60);
            fileType = 'webm';
            setBlob(blob, callback);
            frames = [];
        }

        function recordGIF() {
            if (!window.GIFEncoder) throw 'You must link https://webrtc-experiment.appspot.com/gif-recorder.js';
            if (!video) throw 'Now video element found.';

            console.log('started recording GIF frames');

            video.width = canvas.width = video.videoWidth || 320;
            video.height = canvas.height = video.videoHeight || 240;

            var height = canvas.height,
                width = canvas.width;

            // external library to record as GIF images
            gifEncoder = new GIFEncoder();

            // void setRepeat(int iter) 
            // Sets the number of times the set of GIF frames should be played. 
            // Default is 1; 0 means play indefinitely.
            gifEncoder.setRepeat(0);

            // void setFrameRate(Number fps) 
            // Sets frame rate in frames per second. 
            // Equivalent to setDelay(1000/fps).
            // Using "setDelay" instead of "setFrameRate"
            gifEncoder.setDelay(config.frameRate || 200);

            // void setQuality(int quality) 
            // Sets quality of color quantization (conversion of images to the 
            // maximum 256 colors allowed by the GIF specification). 
            // Lower values (minimum = 1) produce better colors, 
            // but slow processing significantly. 10 is the default, 
            // and produces good color mapping at reasonable speeds. 
            // Values greater than 20 do not yield significant improvements in speed.
            gifEncoder.setQuality(config.quality || 10);

            // Boolean start() 
            // This writes the GIF Header and returns false if it fails.
            gifEncoder.start();

            function drawGifFrame() {
                context.drawImage(video, 0, 0, width, height);
                gifEncoder.addFrame(context);
                requestedAnimationFrame = requestAnimationFrame(drawGifFrame);
            }

            requestedAnimationFrame = requestAnimationFrame(drawGifFrame);
        }

        function stopGIFRecording(callback) {
            if (!gifEncoder) throw 'Seems that GIF encoder is not initialized yet. Too Bad!';

            console.warn('stopped recording GIF frames');
            cancelAnimationFrame(requestedAnimationFrame);

            dataURL = blob = 'data:image/gif;base64,' + encode64(gifEncoder.stream().getData());

            var writer = RecordRTCFileWriter({
                blob: new Uint8Array(gifEncoder.stream().bin),
                type: 'image/gif',
                fileName: (Math.round(Math.random() * 60535) + 5000) + '.gif',
                size: blob.length,
                onsuccess: function(fileEntry) {
                    fileSystemURL = fileEntry.toURL();
                    if (callback) callback(fileSystemURL);
                },
                onerror: function(errorMessage) {
                    console.debug('Unabled to write temporary recorded file using FileWriter APIs.', errorMessage);
                    if (callback) callback(dataURL);
                    var url = writer.toURL();
                    if (url) return window.open(url);
                }
            });
        }

        function recordAudio() {
            if (!config.stream) throw 'No audio stream found.';
            initAudioRecorder(config.audioWorkerPath);
            audioContext = new AudioContext;

            mediaStreamSource = audioContext.createMediaStreamSource(config.stream);
            mediaStreamSource.connect(audioContext.destination);
            recorder = new window.Recorder(mediaStreamSource);

            recorder.record();
        }

        function stopAudioRecording(callback) {
            if (!recorder) return;
            console.warn('stopped recording audio frames');
            recorder.stop();
            recorder.exportWAV(function(blob) {
                fileType = 'wav';
                setBlob(blob, callback);
            });
            recorder.clear();
        }

        function setBlob(_blob, callback) {
            blob = _blob;

            var writer = RecordRTCFileWriter({
                blob: blob,
                type: fileType === 'webm' ? 'video/webm' : 'audio/wav',
                fileName: (Math.round(Math.random() * 60535) + 5000) + '.' + fileType,
                size: blob.length,
                onsuccess: function(fileEntry) {
                    fileSystemURL = fileEntry.toURL();
                    if (callback) callback(fileSystemURL);
                },
                onerror: function(errorMessage) {
                    console.debug('Unabled to write temporary recorded file using FileWriter APIs.', errorMessage);
                    if (callback) callback(dataURL);
                    var url = writer.toURL();
                    if (url) return window.open(url);
                }
            });

            var reader = new win.FileReader();
            reader.readAsDataURL(blob);
            reader.onload = function(event) {
                dataURL = event.target.result;
            };
        }

        function saveToDisk() {
            if (fileSystemURL) return window.open(fileSystemURL);

            console.log('saving recorded stream to disk!');
            var save = document.createElement('a');
            save.href = dataURL;
            save.target = '_blank';
            save.download = (Math.random() * 1000 << 1000) + '.' + fileType;

            var event = document.createEvent('Event');
            event.initEvent('click', true, true);

            save.dispatchEvent(event);
            URL.revokeObjectURL(save.href);
        }

        return {
            recordVideo: recordVideo,
            recordAudio: recordAudio,
            recordGIF: recordGIF,

            stopAudio: stopAudioRecording,
            stopVideo: stopVideoRecording,
            stopGIF: stopGIFRecording,

            save: saveToDisk,
            getBlob: function() {
                return blob;
            },
            getDataURL: function() {
                return dataURL;
            },
            toURL: function() {
                return fileSystemURL || dataURL;
            }
        };
    };

    // longer DataURLs causes crash i.e. "Aww, Snap!" messages.
    // so, writing a temporary file is capable to handle longer DataURl without any crash!

    function RecordRTCFileWriter(config) {
        window.requestFileSystem = window.requestFileSystem || window.webkitRequestFileSystem;
        var file;

        var size = config.size,
            fileName = config.fileName,
            blob = config.blob,
            type = config.type;

        window.requestFileSystem(window.TEMPORARY, size, onsuccess, onerror);

        function onsuccess(fileSystem) {
            fileSystem.root.getFile(fileName, {
                create: true,
                exclusive: false
            }, onsuccess, onerror);

            function onsuccess(fileEntry) {
                fileEntry.createWriter(onsuccess, onerror);

                function onsuccess(fileWriter) {
                    fileWriter.onwriteend = function() {
                        console.log(fileEntry.toURL());
                        file = fileEntry;
                        if (config.onsuccess) config.onsuccess(fileEntry);
                    };

                    fileWriter.onerror = function(e) {
                        error('fileWriter error', e);
                    };

                    blob = new Blob([blob], {
                        type: type
                    });

                    fileWriter.write(blob);
                }

                function onerror(e) {
                    error('fileEntry error', e);
                }
            }

            function onerror(e) {
                error('fileSystem error', e);
            }
        }

        function onerror(e) {
            error('requestFileSystem error', e);
        }

        var errorMessage;

        function error(level, e) {
            var msg = '';

            switch (e.code) {
            case FileError.QUOTA_EXCEEDED_ERR:
                msg = 'QUOTA_EXCEEDED_ERR';
                break;
            case FileError.NOT_FOUND_ERR:
                msg = 'NOT_FOUND_ERR';
                break;
            case FileError.SECURITY_ERR:
                msg = 'SECURITY_ERR';
                break;
            case FileError.INVALID_MODIFICATION_ERR:
                msg = 'INVALID_MODIFICATION_ERR';
                break;
            case FileError.INVALID_STATE_ERR:
                msg = 'INVALID_STATE_ERR';
                break;
            default:
                msg = 'Unknown Error';
                break;
            }

            errorMessage = msg;
            if (config.onerror) config.onerror(errorMessage);
            if (errorMessage === 'SECURITY_ERR')
                errorMessage = 'SECURITY_ERR: Are you using chrome incognito mode? It seems that access to "requestFileSystem" API is denied.';

            console.error(level + ':\n' + errorMessage);
        }

        return {
            toURL: function() {
                return errorMessage ? false : file.toURL();
            }
        };
    }

    // external library to record audio
    // https://github.com/mattdiamond/Recorderjs

    function initAudioRecorder(audioWorkerPath) {
        var WORKER_PATH = audioWorkerPath || 'https://webrtc-experiment.appspot.com/audio-recorder.js';

        var Recorder = function(source, cfg) {
            var config = cfg || { };
            var bufferLen = config.bufferLen || 4096;
            this.context = source.context;
            this.node = this.context.createJavaScriptNode(bufferLen, 2, 2);

            console.log("WORKER_PATH = " + WORKER_PATH);
            console.log("config.workerPath = " + config.workerPath);
            var worker = new Worker(config.workerPath || WORKER_PATH);
            worker.postMessage({
                command: 'init',
                config: {
                    sampleRate: this.context.sampleRate
                }
            });
            var recording = false,
                currCallback;

            this.node.onaudioprocess = function(e) {
                if (!recording) return;

                var buffer = [
                    e.inputBuffer.getChannelData(0),
                    e.inputBuffer.getChannelData(1)
                ];

                worker.postMessage({
                    command: 'record',
                    buffer: buffer
                });
            };

            this.record = function() {
                recording = true;
            };

            this.stop = function() {
                recording = false;
            };

            this.clear = function() {
                worker.postMessage({
                    command: 'clear'
                });
            };

            this.getBuffer = function(cb) {
                currCallback = cb || config.callback;
                worker.postMessage({
                    command: 'getBuffer'
                });
            };

            this.exportWAV = function(cb, type) {
                currCallback = cb || config.callback;
                type = type || config.type || 'audio/wav';
                if (!currCallback) throw new Error('Callback not set');
                worker.postMessage({
                    command: 'exportWAV',
                    type: type
                });
            };

            worker.onmessage = function(e) {
                var blob = e.data;
                currCallback(blob);
            };

            source.connect(this.node);
            this.node.connect(this.context.destination);
        };

        window.Recorder = Recorder;
    }

    // external library to record video in WebM format
    // https://github.com/antimatter15/whammy
    var Whammy=function(){function g(a){for(var b=a[0].width,e=a[0].height,c=a[0].duration,d=1;d<a.length;d++){if(a[d].width!=b)throw"Frame "+(d+1)+" has a different width";if(a[d].height!=e)throw"Frame "+(d+1)+" has a different height";if(0>a[d].duration)throw"Frame "+(d+1)+" has a weird duration";c+=a[d].duration}var f=0,a=[{id:440786851,data:[{data:1,id:17030},{data:1,id:17143},{data:4,id:17138},{data:8,id:17139},{data:"webm",id:17026},{data:2,id:17031},{data:2,id:17029}]},{id:408125543,data:[{id:357149030,
    data:[{data:1E6,id:2807729},{data:"whammy",id:19840},{data:"whammy",id:22337},{data:[].slice.call(new Uint8Array((new Float64Array([c])).buffer),0).map(function(a){return String.fromCharCode(a)}).reverse().join(""),id:17545}]},{id:374648427,data:[{id:174,data:[{data:1,id:215},{data:1,id:25541},{data:0,id:156},{data:"und",id:2274716},{data:"V_VP8",id:134},{data:"VP8",id:2459272},{data:1,id:131},{id:224,data:[{data:b,id:176},{data:e,id:186}]}]}]},{id:524531317,data:[{data:0,id:231}].concat(a.map(function(a){var b;
    b=a.data.slice(4);var c=Math.round(f);b=[129,c>>8,c&255,128].map(function(a){return String.fromCharCode(a)}).join("")+b;f+=a.duration;return{data:b,id:163}}))}]}];return j(a)}function m(a){for(var b=[];0<a;)b.push(a&255),a>>=8;return new Uint8Array(b.reverse())}function k(a){for(var b=[],a=(a.length%8?Array(9-a.length%8).join("0"):"")+a,e=0;e<a.length;e+=8)b.push(parseInt(a.substr(e,8),2));return new Uint8Array(b)}function j(a){for(var b=[],e=0;e<a.length;e++){var c=a[e].data;"object"==typeof c&&
    (c=j(c));"number"==typeof c&&(c=k(c.toString(2)));if("string"==typeof c){for(var d=new Uint8Array(c.length),f=0;f<c.length;f++)d[f]=c.charCodeAt(f);c=d}f=c.size||c.byteLength;d=Math.ceil(Math.ceil(Math.log(f)/Math.log(2))/8);f=f.toString(2);f=Array(7*d+8-f.length).join("0")+f;d=Array(d).join("0")+"1"+f;b.push(m(a[e].id));b.push(k(d));b.push(c)}return new Blob(b,{type:"video/webm"})}function l(a){for(var b=a.RIFF[0].WEBP[0],e=b.indexOf("\u009d\u0001*"),c=0,d=[];4>c;c++)d[c]=b.charCodeAt(e+3+c);c=d[1]<<
    8|d[0];e=c&16383;c=d[3]<<8|d[2];return{width:e,height:c&16383,data:b,riff:a}}function h(a){for(var b=0,e={};b<a.length;){var c=a.substr(b,4),d=parseInt(a.substr(b+4,4).split("").map(function(a){a=a.charCodeAt(0).toString(2);return Array(8-a.length+1).join("0")+a}).join(""),2),f=a.substr(b+4+4,d),b=b+(8+d);e[c]=e[c]||[];"RIFF"==c||"LIST"==c?e[c].push(h(f)):e[c].push(f)}return e}function i(a,b){this.frames=[];this.duration=1E3/a;this.quality=b||0.8}i.prototype.add=function(a,b){if("undefined"!=typeof b&&
    this.duration)throw"you can't pass a duration if the fps is set";if("undefined"==typeof b&&!this.duration)throw"if you don't have the fps set, you ned to have durations here.";a.canvas&&(a=a.canvas);if(a.toDataURL)a=a.toDataURL("image/webp",this.quality);else if("string"!=typeof a)throw"frame must be a a HTMLCanvasElement, a CanvasRenderingContext2D or a DataURI formatted string";if(!/^data:image\/webp;base64,/ig.test(a))throw"Input must be formatted properly as a base64 encoded DataURI of type image/webp";
    this.frames.push({image:a,duration:b||this.duration})};i.prototype.compile=function(){return new g(this.frames.map(function(a){var b=l(h(atob(a.image.slice(23))));b.duration=a.duration;return b}))};return{Video:i,fromImageArray:function(a,b){return g(a.map(function(a){a=l(h(atob(a.slice(23))));a.duration=1E3/b;return a}))},toWebM:g}}();
})();