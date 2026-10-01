import {useSyncExternalStore} from 'react';import ImageViewer from './ImageViewer';import {imageViewerController} from './media-controller';
export default function ImageViewerHost(){const view=useSyncExternalStore(imageViewerController.subscribe,imageViewerController.get);return view?<ImageViewer key={view.initialId} {...view} onClose={imageViewerController.close}/>:null;}
