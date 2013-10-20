define(['text!flight/listView.html'], function(listViewTemplate) {

    var IndexView = Piece.View.extend({

        id: 'flightstatus-list',

        events: {
            "click #querymore": "queryMore",
            "click #refresh": "reload"
        },

        bindings: {
            "Segment:change io": "onIOChange",
            "List:select flightstatus-list": "onItemSelect"
        },

        render: function() {

            $(this.el).html(listViewTemplate);

            Piece.View.prototype.render.call(this);

            this.component('io').triggerChange();
            var list = this.component('flightstatus-list');

            if (list.isExistStoreData('flightstatus-list')) {
                list.loadListByStoreData();
            } else {
                list.setRequestParams();
            }

            return this;
        },

        onItemSelect: function(list, data) {
            this.navigate('detailView', {
                trigger: true
            });
        },

        onGotResult: function(params) {
            alert(params);
        },

        onIOChange: function(comp) {
            var io = comp.getValue();
        },

        queryMore: function() {
            console.info(this.container);
            this.container.navigateForResult('/examples/selectView', {
                trigger: true
            }, '/examples/listView', this.onGotResult);
        },

        reload: function() {
            console.info(this.container);
            this.container.navigateForResult('/examples/demoIndex', {
                trigger: true
            }, '/examples/dialog', this.onGotResult);
        }
    });

    return IndexView;
});