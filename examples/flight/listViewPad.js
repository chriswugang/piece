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

            alert("paddddddddddddddddddddddddddddddddddd");

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
            this.container.navigateForResult('/com.foss.m2/selectView', {
                trigger: true
            }, '/com.foss.bb/listView', this.onGotResult);
        },

        reload: function() {
            console.info(this.container);
            this.container.navigateForResult('/com.foss.demo2/demoIndex', {
                trigger: true
            }, '/com.foss.demo2/dialog', this.onGotResult);
        }
    });

    return IndexView;
});